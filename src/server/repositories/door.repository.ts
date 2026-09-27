import {
  aliasedTable,
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  max,
  or,
  sql,
} from 'drizzle-orm';
import { db } from '@/db/client';
import type { DbExecutor } from '@/db/executor';
import { doorPasses, doorScans, events, orders, ticketTypes, tickets } from '@/db/schema';
import { DoorPassCodeCollisionError, DoorScanIdTakenError } from '@/server/lib/errors';
import { isUniqueViolation } from '@/server/lib/pg-errors';

/**
 * ADR-030 gate check-in: gate passes, the append-only scan log, and the
 * read models a door phone needs. Nothing here returns a buyer's email or
 * full phone; the only buyer detail is the last 3 digits of the phone, the
 * verbal check for a name-search admit.
 */

export type DoorPassRecord = typeof doorPasses.$inferSelect;
export type DoorScanRecord = typeof doorScans.$inferSelect;
export type NewDoorScan = typeof doorScans.$inferInsert;

/** One ticket as the door sees it, with everything a result screen shows. */
export interface DoorTicket {
  id: string;
  code: string;
  status: 'issued' | 'cancelled';
  attendeeName: string;
  position: number;
  orderId: string;
  eventId: string;
  eventTitle: string;
  ticketTypeName: string;
  /** "ticket 2 of 3": the order's size. */
  orderQuantity: number;
  checkedInAt: Date | null;
  checkedInBy: string | null;
  checkedInScanId: string | null;
  /** The pass whose scan checked it in, when that scan is logged. */
  checkedInPassId: string | null;
  /**
   * Last 3 digits of the buying phone, or null (a comp has none). Server
   * side only: a name-search admit is checked against it, and it is never
   * sent to the door phone.
   */
  buyerPhoneLast3: string | null;
}

export interface DoorSearchRow {
  ticketId: string;
  attendeeName: string;
  ticketTypeName: string;
  status: 'issued' | 'cancelled';
  checkedInAt: Date | null;
  checkedInBy: string | null;
  /** False for a comp: there is no buying phone to check a name-search admit against. */
  phoneOnFile: boolean;
}

/**
 * One ticket on a door phone's offline list (ADR-034). The code is here
 * only so the service can hash it — it never leaves the server in clear.
 */
export interface OfflineListRow {
  id: string;
  code: string;
  status: 'issued' | 'cancelled';
  attendeeName: string;
  ticketTypeName: string;
  position: number;
  orderQuantity: number;
  checkedInAt: Date | null;
  checkedInBy: string | null;
}

/**
 * A double entry (ADR-034): an offline door showed ADMIT, and when its scan
 * reached the server the ticket was already in (or cancelled).
 */
export interface OfflineConflictRow {
  scanId: string;
  gate: string;
  result: DoorScanRecord['result'];
  /** The offline phone's (corrected) clock when it admitted. */
  scannedAt: Date | null;
  receivedAt: Date;
  ticketId: string | null;
  orderId: string | null;
  attendeeName: string | null;
  ticketTypeName: string | null;
  /** The check-in that beat it: when and at which gate. */
  priorCheckedInAt: Date | null;
  priorCheckedInBy: string | null;
}

export interface PassListRow {
  pass: DoorPassRecord;
  scans: number;
  /** Scans that were made offline and synced later (ADR-034). */
  offlineScans: number;
  admitted: number;
  searchAdmits: number;
  lastScanAt: Date | null;
}

export interface RecentScanRow {
  scan: DoorScanRecord;
  attendeeName: string | null;
  ticketTypeName: string | null;
  /** The ticket is still checked in by this very scan (so it can be undone). */
  stillCheckedInByThisScan: boolean;
}

export interface DoorRepository {
  /** @throws DoorPassCodeCollisionError */
  insertPass(values: {
    eventId: string;
    label: string;
    code: string;
    createdBy: string;
  }): Promise<DoorPassRecord>;
  findPassByCode(code: string): Promise<DoorPassRecord | null>;
  findPassById(id: string): Promise<DoorPassRecord | null>;
  /** Conditional: only a pass not yet revoked. Null when it already was. */
  revokePass(id: string, tx?: DbExecutor): Promise<DoorPassRecord | null>;
  /**
   * First statement of every scan/undo transaction: FOR SHARE on the pass
   * row while it is not revoked. Scans on one pass never block each other,
   * but a revoke (NO KEY UPDATE) waits for the ones in flight — so
   * revoke-and-undo sees every check-in they make — and any scan after it
   * finds the pass revoked. False when revoked.
   */
  lockActivePass(id: string, tx: DbExecutor): Promise<boolean>;
  listPasses(eventId: string): Promise<PassListRow[]>;
  /** @throws DoorScanIdTakenError when this scan id is already logged. */
  insertScan(values: NewDoorScan, tx?: DbExecutor): Promise<DoorScanRecord>;
  findScanByScanId(scanId: string): Promise<DoorScanRecord | null>;
  /**
   * One query (ticket + type + order size + event + the checking-in pass).
   * Pass `tx` inside a scan transaction: a pool read there could starve
   * the pool while concurrent scans hold connections waiting on the row.
   */
  findTicket(where: { code: string } | { id: string }, tx?: DbExecutor): Promise<DoorTicket | null>;
  /** Name substring or exact code, within one event; at most `limit` rows. */
  searchTickets(
    eventId: string,
    term: { name: string; code: string | null },
    limit: number,
  ): Promise<DoorSearchRow[]>;
  recentScans(passId: string, limit: number): Promise<RecentScanRow[]>;
  /** Every ticket of the event, all statuses — the door phone's offline list. */
  offlineList(eventId: string): Promise<OfflineListRow[]>;
  /**
   * Offline admits that found the ticket already in or cancelled, oldest
   * first. Not a double entry: an offline admit that replaced an online
   * request which itself admitted (the same person — the answer was lost).
   */
  offlineConflicts(eventId: string): Promise<OfflineConflictRow[]>;
  counts(eventId: string): Promise<{ issued: number; checkedIn: number }>;
  /** Tickets still checked in by one of this pass's scans (revoke-and-undo). */
  ticketsCheckedInByPass(
    passId: string,
    tx: DbExecutor,
  ): Promise<{ id: string; code: string; orderId: string; checkedInScanId: string }[]>;
}

const PASS_CODE_UNIQUE = 'door_passes_code_unique';
const SCAN_ID_UNIQUE = 'door_scans_scan_id_unique';

/** `%` and `_` in a typed term must match literally, not as wildcards. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const checkingScan = aliasedTable(doorScans, 'checking_scan');
const supersededScan = aliasedTable(doorScans, 'superseded_scan');

export const doorRepository: DoorRepository = {
  async insertPass(values) {
    try {
      const [row] = await db.insert(doorPasses).values(values).returning();
      if (!row) throw new Error('insert returned no row');
      return row;
    } catch (err: unknown) {
      if (isUniqueViolation(err, PASS_CODE_UNIQUE)) throw new DoorPassCodeCollisionError();
      throw err;
    }
  },

  async findPassByCode(code) {
    const [row] = await db.select().from(doorPasses).where(eq(doorPasses.code, code)).limit(1);
    return row ?? null;
  },

  async findPassById(id) {
    const [row] = await db.select().from(doorPasses).where(eq(doorPasses.id, id)).limit(1);
    return row ?? null;
  },

  async revokePass(id, tx = db) {
    const [row] = await tx
      .update(doorPasses)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(doorPasses.id, id), sql`${doorPasses.revokedAt} IS NULL`))
      .returning();
    return row ?? null;
  },

  async lockActivePass(id, tx) {
    const [row] = await tx
      .select({ id: doorPasses.id })
      .from(doorPasses)
      .where(and(eq(doorPasses.id, id), isNull(doorPasses.revokedAt)))
      .for('share');
    return row !== undefined;
  },

  async listPasses(eventId) {
    const rows = await db
      .select({
        pass: doorPasses,
        scans: count(doorScans.id),
        offlineScans: sql<number>`(count(*) filter (where ${doorScans.mode} = 'offline'))::int`,
        admitted: sql<number>`(count(*) filter (where ${doorScans.result} = 'admitted'))::int`,
        searchAdmits: sql<number>`(count(*) filter (where ${doorScans.result} = 'admitted' and ${doorScans.method} = 'search'))::int`,
        lastScanAt: max(doorScans.receivedAt),
      })
      .from(doorPasses)
      .leftJoin(doorScans, eq(doorScans.passId, doorPasses.id))
      .where(eq(doorPasses.eventId, eventId))
      .groupBy(doorPasses.id)
      .orderBy(asc(doorPasses.createdAt));
    return rows.map((r) => ({ ...r, lastScanAt: r.lastScanAt ?? null }));
  },

  async insertScan(values, tx = db) {
    try {
      const [row] = await tx.insert(doorScans).values(values).returning();
      if (!row) throw new Error('insert returned no row');
      return row;
    } catch (err: unknown) {
      if (isUniqueViolation(err, SCAN_ID_UNIQUE)) throw new DoorScanIdTakenError(values.scanId);
      throw err;
    }
  },

  async findScanByScanId(scanId) {
    const [row] = await db.select().from(doorScans).where(eq(doorScans.scanId, scanId)).limit(1);
    return row ?? null;
  },

  async findTicket(where, tx = db) {
    const [row] = await tx
      .select({
        id: tickets.id,
        code: tickets.code,
        status: tickets.status,
        attendeeName: tickets.attendeeName,
        position: tickets.position,
        orderId: tickets.orderId,
        eventId: tickets.eventId,
        eventTitle: events.title,
        ticketTypeName: ticketTypes.name,
        orderQuantity: orders.quantity,
        checkedInAt: tickets.checkedInAt,
        checkedInBy: tickets.checkedInBy,
        checkedInScanId: tickets.checkedInScanId,
        checkedInPassId: checkingScan.passId,
        buyerPhoneLast3: sql<string | null>`right(${orders.buyerPhone}, 3)`,
      })
      .from(tickets)
      .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
      .innerJoin(orders, eq(orders.id, tickets.orderId))
      .innerJoin(events, eq(events.id, tickets.eventId))
      .leftJoin(checkingScan, eq(checkingScan.scanId, tickets.checkedInScanId))
      .where('code' in where ? eq(tickets.code, where.code) : eq(tickets.id, where.id))
      .limit(1);
    return row ?? null;
  },

  async searchTickets(eventId, term, limit) {
    // Every reading of the term, ORed: "mahmudur" is 8 letters of the code
    // alphabet, so it also parses as a code — the name must still match.
    const byName = ilike(tickets.attendeeName, `%${escapeLike(term.name)}%`);
    const match = term.code ? or(eq(tickets.code, term.code), byName) : byName;
    return db
      .select({
        ticketId: tickets.id,
        attendeeName: tickets.attendeeName,
        ticketTypeName: ticketTypes.name,
        status: tickets.status,
        checkedInAt: tickets.checkedInAt,
        checkedInBy: tickets.checkedInBy,
        // Whether there is a phone to check — never the digits themselves.
        phoneOnFile: sql<boolean>`${orders.buyerPhone} IS NOT NULL`,
      })
      .from(tickets)
      .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
      .innerJoin(orders, eq(orders.id, tickets.orderId))
      .where(and(eq(tickets.eventId, eventId), match))
      .orderBy(asc(tickets.attendeeName), asc(tickets.position))
      .limit(limit);
  },

  async recentScans(passId, limit) {
    const rows = await db
      .select({
        scan: doorScans,
        attendeeName: tickets.attendeeName,
        ticketTypeName: ticketTypes.name,
        checkedInScanId: tickets.checkedInScanId,
      })
      .from(doorScans)
      // Same event only: a wrong-event scan must not show that event's attendee.
      .leftJoin(
        tickets,
        and(eq(tickets.id, doorScans.ticketId), eq(tickets.eventId, doorScans.eventId)),
      )
      .leftJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
      .where(eq(doorScans.passId, passId))
      // When it happened: a synced offline scan by the phone's (corrected)
      // clock, so an hour of offline scans lands where it belongs.
      .orderBy(
        desc(
          sql`CASE WHEN ${doorScans.mode} = 'offline' THEN coalesce(${doorScans.scannedAt}, ${doorScans.receivedAt}) ELSE ${doorScans.receivedAt} END`,
        ),
        desc(doorScans.receivedAt),
      )
      .limit(limit);
    return rows.map(({ checkedInScanId, ...r }) => ({
      ...r,
      stillCheckedInByThisScan: checkedInScanId === r.scan.scanId,
    }));
  },

  offlineList(eventId) {
    return db
      .select({
        id: tickets.id,
        code: tickets.code,
        status: tickets.status,
        attendeeName: tickets.attendeeName,
        ticketTypeName: ticketTypes.name,
        position: tickets.position,
        orderQuantity: orders.quantity,
        checkedInAt: tickets.checkedInAt,
        checkedInBy: tickets.checkedInBy,
      })
      .from(tickets)
      .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
      .innerJoin(orders, eq(orders.id, tickets.orderId))
      .where(eq(tickets.eventId, eventId))
      .orderBy(asc(tickets.attendeeName), asc(tickets.position));
  },

  offlineConflicts(eventId) {
    return db
      .select({
        scanId: doorScans.scanId,
        gate: doorPasses.label,
        result: doorScans.result,
        scannedAt: doorScans.scannedAt,
        receivedAt: doorScans.receivedAt,
        ticketId: doorScans.ticketId,
        orderId: tickets.orderId,
        attendeeName: tickets.attendeeName,
        ticketTypeName: ticketTypes.name,
        priorCheckedInAt: doorScans.priorCheckedInAt,
        priorCheckedInBy: doorScans.priorCheckedInBy,
      })
      .from(doorScans)
      .innerJoin(doorPasses, eq(doorPasses.id, doorScans.passId))
      .leftJoin(
        tickets,
        and(eq(tickets.id, doorScans.ticketId), eq(tickets.eventId, doorScans.eventId)),
      )
      .leftJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
      .leftJoin(supersededScan, eq(supersededScan.scanId, doorScans.supersedesScanId))
      .where(
        and(
          eq(doorScans.eventId, eventId),
          eq(doorScans.mode, 'offline'),
          eq(doorScans.doorVerdict, 'admitted'),
          sql`${doorScans.result} <> 'admitted'`,
          // The online request this scan replaced did admit: same person.
          sql`${supersededScan.result} IS DISTINCT FROM 'admitted'`,
        ),
      )
      .orderBy(asc(doorScans.receivedAt));
  },

  async counts(eventId) {
    const [row] = await db
      .select({
        issued: sql<number>`(count(*) filter (where ${tickets.status} = 'issued'))::int`,
        checkedIn: sql<number>`(count(*) filter (where ${tickets.checkedInAt} is not null))::int`,
      })
      .from(tickets)
      .where(eq(tickets.eventId, eventId));
    return { issued: row?.issued ?? 0, checkedIn: row?.checkedIn ?? 0 };
  },

  ticketsCheckedInByPass(passId, tx) {
    return tx
      .select({
        id: tickets.id,
        code: tickets.code,
        orderId: tickets.orderId,
        checkedInScanId: doorScans.scanId,
      })
      .from(tickets)
      .innerJoin(doorScans, eq(doorScans.scanId, tickets.checkedInScanId))
      .where(and(eq(doorScans.passId, passId), isNotNull(tickets.checkedInAt)));
  },
};
