import { and, asc, count, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import type { DbExecutor } from '@/db/executor';
import { orders, ticketTypes, tickets } from '@/db/schema';
import { TicketCodeCollisionError } from '@/server/lib/errors';
import { isUniqueViolation } from '@/server/lib/pg-errors';

/**
 * The only module that touches Drizzle for `tickets`. Rows are created by
 * fulfilment (Invariant 4) inside the approve transaction; the one status
 * write, `cancel`, is a conditional UPDATE like every other status write.
 * The attendee name is the one buyer-editable column.
 */

export type TicketRecord = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;

/**
 * One line of the check-in list (B11): the ticket plus the two names the
 * door staff read — the type and the order reference. Deliberately no
 * buyer email or phone: the list is printed and handed around.
 */
export interface CheckInTicketRow {
  ticket: TicketRecord;
  orderReference: string;
  ticketTypeName: string;
}

export interface TicketsRepository {
  /** @throws TicketCodeCollisionError when any code is already taken. */
  insertMany(rows: NewTicket[], tx?: DbExecutor): Promise<TicketRecord[]>;
  listByOrder(orderId: string): Promise<TicketRecord[]>;
  findByCode(code: string): Promise<TicketRecord | null>;
  /** Same row, locked for the rest of `tx` (SELECT … FOR UPDATE). */
  findByIdForUpdate(id: string, tx: DbExecutor): Promise<TicketRecord | null>;
  /**
   * THE ticket status write: `issued → cancelled` only while still
   * `issued` and not checked in (ADR-030). Null when it is not — the caller
   * lost a race and must not release a seat for it.
   */
  cancel(id: string, tx?: DbExecutor): Promise<TicketRecord | null>;
  /**
   * ADR-030 gate check-in, one conditional UPDATE: only an `issued` ticket
   * not yet checked in. Null when it is not — exactly one of any number of
   * concurrent scans wins, the way inventory holds do (Invariant 2).
   * `at` is for a synced offline admit (ADR-034): when the person actually
   * walked in, already clamped by the service. Default: the database clock.
   */
  checkIn(
    id: string,
    by: { gate: string; scanId: string; at?: Date },
    tx: DbExecutor,
  ): Promise<TicketRecord | null>;
  /**
   * The audited reverse, as a compare-and-swap: only while `scanId` is
   * still the scan that checked the ticket in. Every undo names the check-in
   * it means (the door's own admit, the one the admin was shown, the ones a
   * revoked pass made), so it can never clear a later, legitimate one. Null
   * when the ticket is not (or no longer) checked in by that scan.
   */
  undoCheckIn(id: string, tx: DbExecutor, scanId: string): Promise<TicketRecord | null>;
  /**
   * Live tickets left on the order — zero means the order itself is over.
   * Transaction-only: it must see the cancel that just happened in `tx`.
   */
  countIssuedByOrder(orderId: string, tx: DbExecutor): Promise<number>;
  /**
   * B11: every ticket of one event, all statuses, by attendee name then
   * code. Unbounded on purpose — a door list is capped by the event's
   * capacity and has to be printed whole.
   */
  listForEvent(eventId: string): Promise<CheckInTicketRow[]>;
  /**
   * Renames while still `issued` AND the name is still `expectedName`
   * (compare-and-swap), so a concurrent rename is refused rather than
   * overwritten and the audit row's "old name" is exact. Null when either
   * condition fails.
   */
  updateAttendeeName(
    id: string,
    expectedName: string,
    attendeeName: string,
    tx?: DbExecutor,
  ): Promise<TicketRecord | null>;
}

// Constraint name as generated in drizzle/0000_*.sql.
const CODE_UNIQUE = 'tickets_code_unique';

export const ticketsRepository: TicketsRepository = {
  async insertMany(rows, tx = db) {
    if (rows.length === 0) return [];
    try {
      return await tx.insert(tickets).values(rows).returning();
    } catch (err: unknown) {
      if (isUniqueViolation(err, CODE_UNIQUE)) {
        throw new TicketCodeCollisionError(rows.map((r) => r.code).join(','));
      }
      throw err;
    }
  },

  listByOrder(orderId) {
    return db
      .select()
      .from(tickets)
      .where(eq(tickets.orderId, orderId))
      .orderBy(asc(tickets.position), asc(tickets.createdAt), asc(tickets.code));
  },

  async findByCode(code) {
    const [row] = await db.select().from(tickets).where(eq(tickets.code, code)).limit(1);
    return row ?? null;
  },

  async findByIdForUpdate(id, tx) {
    const [row] = await tx.select().from(tickets).where(eq(tickets.id, id)).for('update');
    return row ?? null;
  },

  async cancel(id, tx = db) {
    const [row] = await tx
      .update(tickets)
      .set({ status: 'cancelled', updatedAt: sql`now()` })
      .where(and(eq(tickets.id, id), eq(tickets.status, 'issued'), isNull(tickets.checkedInAt)))
      .returning();
    return row ?? null;
  },

  async checkIn(id, { gate, scanId, at }, tx) {
    const [row] = await tx
      .update(tickets)
      .set({
        checkedInAt: at ?? sql`clock_timestamp()`,
        checkedInBy: gate,
        checkedInScanId: scanId,
        updatedAt: sql`now()`,
      })
      .where(and(eq(tickets.id, id), eq(tickets.status, 'issued'), isNull(tickets.checkedInAt)))
      .returning();
    return row ?? null;
  },

  async undoCheckIn(id, tx, scanId) {
    const [row] = await tx
      .update(tickets)
      .set({ checkedInAt: null, checkedInBy: null, checkedInScanId: null, updatedAt: sql`now()` })
      .where(
        and(
          eq(tickets.id, id),
          isNotNull(tickets.checkedInAt),
          eq(tickets.checkedInScanId, scanId),
        ),
      )
      .returning();
    return row ?? null;
  },

  async countIssuedByOrder(orderId, tx) {
    const [row] = await tx
      .select({ n: count() })
      .from(tickets)
      .where(and(eq(tickets.orderId, orderId), eq(tickets.status, 'issued')));
    return row?.n ?? 0;
  },

  listForEvent(eventId) {
    return db
      .select({
        ticket: tickets,
        orderReference: orders.reference,
        ticketTypeName: ticketTypes.name,
      })
      .from(tickets)
      .innerJoin(orders, eq(tickets.orderId, orders.id))
      .innerJoin(ticketTypes, eq(tickets.ticketTypeId, ticketTypes.id))
      .where(eq(tickets.eventId, eventId))
      .orderBy(asc(tickets.attendeeName), asc(tickets.code));
  },

  async updateAttendeeName(id, expectedName, attendeeName, tx = db) {
    const [row] = await tx
      .update(tickets)
      .set({ attendeeName, updatedAt: sql`now()` })
      .where(
        and(
          eq(tickets.id, id),
          eq(tickets.status, 'issued'),
          eq(tickets.attendeeName, expectedName),
        ),
      )
      .returning();
    return row ?? null;
  },
};
