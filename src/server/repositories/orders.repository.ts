import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  or,
  sql,
  sum,
  type SQL,
} from 'drizzle-orm';
import { db } from '@/db/client';
import type { DbExecutor } from '@/db/executor';
import { events, orderEvents, orders, ticketTypes } from '@/db/schema';
import { OrderReferenceCollisionError, TrxIdAlreadyUsedError } from '@/server/lib/errors';
import type { OrderStatus } from '@/server/lib/order-status';
import { isUniqueViolation } from '@/server/lib/pg-errors';

/**
 * The only module that touches Drizzle for `orders` and `order_events`.
 * `order_events` is append-only (Invariant 6): there is an insert and reads,
 * never an update or delete. Status changes arrive in later slices as
 * conditional UPDATEs (`WHERE status = $from`), never as blind writes.
 */

export type OrderRecord = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderEventRecord = typeof orderEvents.$inferSelect;
export type NewOrderEvent = typeof orderEvents.$inferInsert;

/** Columns a status transition may set alongside the new status. */
export type OrderTransitionPatch = Partial<
  Pick<
    NewOrder,
    'bkashTrxId' | 'bkashSenderMsisdn' | 'holdExpiresAt' | 'rejectionReason' | 'rejectionNote'
  >
>;

/** One row of the verification queue (B7): the order plus what the admin compares. */
export interface QueueRow {
  order: OrderRecord;
  eventTitle: string;
  ticketTypeName: string;
}

/** B9 filter: every field optional; the repository ANDs what is set. */
export interface OrdersSearchFilter {
  /** ORed equality on reference / trxID / phone, ILIKE on email. */
  term?: {
    reference: string | null;
    trxId: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  status?: OrderStatus | null;
  eventId?: string | null;
  /** Inclusive lower bound on created_at. */
  createdFrom?: Date | null;
  /** Exclusive upper bound on created_at. */
  createdBefore?: Date | null;
}

export interface OrdersSearchPage {
  rows: QueueRow[];
  total: number;
}

/** B9 sort: a whitelisted column name (validation/orders-search.ts) + direction. */
export interface OrdersSort {
  column: 'created' | 'total' | 'reference' | 'status' | 'buyer';
  desc: boolean;
}

/** One row of the status strip: how many orders and how much money per status. */
export interface StatusTotal {
  status: OrderStatus;
  count: number;
  totalPaisa: number;
  /** B13: how many of `count` are complimentary (৳0, never paid) — from the same snapshot. */
  compCount: number;
}

export interface OrderTransition {
  /** The statuses the row must currently be in for the write to apply. */
  from: readonly OrderStatus[];
  to: OrderStatus;
  patch?: OrderTransitionPatch;
}

/** What the expiry job needs per lapsed hold. */
export interface LapsedHold {
  id: string;
  ticketTypeId: string;
  quantity: number;
}

export interface OrdersRepository {
  /** @throws OrderReferenceCollisionError when the reference is taken (retry with a new one). */
  insert(values: NewOrder, tx?: DbExecutor): Promise<OrderRecord>;
  /** Appends one audit row. Every status change writes one (Invariant 6). */
  insertEvent(values: NewOrderEvent, tx?: DbExecutor): Promise<OrderEventRecord>;
  findById(id: string): Promise<OrderRecord | null>;
  /** Same row, locked for the rest of `tx` (SELECT … FOR UPDATE). */
  findByIdForUpdate(id: string, tx: DbExecutor): Promise<OrderRecord | null>;
  findByReference(reference: string): Promise<OrderRecord | null>;
  listEvents(orderId: string): Promise<OrderEventRecord[]>;
  /**
   * THE status write: a conditional UPDATE that applies only while the row
   * is still in one of `from`. Resolves null when it is not — the caller
   * reloads and reports the real state. Never a blind write.
   * @throws TrxIdAlreadyUsedError when the patch's trxID is on another order.
   */
  transition(id: string, change: OrderTransition, tx?: DbExecutor): Promise<OrderRecord | null>;
  /** `pending_payment` orders whose hold passed before `now`, oldest first. */
  listLapsedHolds(now: Date, limit: number): Promise<LapsedHold[]>;
  /**
   * B7: every `pending_verification` order, oldest submission first. The
   * trxID submission is the last write, so `updated_at` is the queue clock.
   * Unbounded on purpose — a single organizer's queue is tens of rows; the
   * Orders list (B9) will paginate and must not reuse this.
   */
  listVerificationQueue(): Promise<QueueRow[]>;
  countByStatus(status: OrderStatus): Promise<number>;
  /** "My orders": everything placed with this (lower-cased) email, newest first. */
  listByBuyerEmail(email: string): Promise<QueueRow[]>;
  /**
   * B9: filtered, newest first, one page plus the total for the pager.
   * `limit` is the caller's page size (the CSV export passes its cap).
   */
  search(
    filter: OrdersSearchFilter,
    page: { limit: number; offset: number },
    sort?: OrdersSort,
  ): Promise<OrdersSearchPage>;
  /** B9 status strip: count and sum(total) per status for the same filter, ignoring `filter.status`. */
  totalsByStatus(filter: OrdersSearchFilter): Promise<StatusTotal[]>;
}

// Constraint names as generated in drizzle/0000_*.sql.
const REFERENCE_UNIQUE = 'orders_reference_unique';
const TRX_ID_UNIQUE = 'orders_bkash_trx_id_uq';

export const ordersRepository: OrdersRepository = {
  async insert(values, tx = db) {
    try {
      const [row] = await tx.insert(orders).values(values).returning();
      if (!row) throw new Error('insert returned no row');
      return row;
    } catch (err: unknown) {
      if (isUniqueViolation(err, REFERENCE_UNIQUE)) {
        throw new OrderReferenceCollisionError(values.reference);
      }
      throw err;
    }
  },

  async insertEvent(values, tx = db) {
    const [row] = await tx.insert(orderEvents).values(values).returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  async findById(id) {
    const [row] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    return row ?? null;
  },

  async findByIdForUpdate(id, tx) {
    // NO KEY UPDATE, not UPDATE: it still excludes every other order writer
    // (they all take this lock), but does not conflict with the KEY SHARE a
    // child-row INSERT takes on the order through its FK — a buyer's rename
    // writing its order_events row while an admin cancels a sibling ticket
    // would otherwise deadlock (found in review). Nobody updates the key.
    const [row] = await tx.select().from(orders).where(eq(orders.id, id)).for('no key update');
    return row ?? null;
  },

  async findByReference(reference) {
    const [row] = await db.select().from(orders).where(eq(orders.reference, reference)).limit(1);
    return row ?? null;
  },

  listEvents(orderId) {
    return db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(orderEvents.createdAt);
  },

  async transition(id, { from, to, patch = {} }, tx = db) {
    try {
      const [row] = await tx
        .update(orders)
        .set({ ...patch, status: to, updatedAt: sql`now()` })
        .where(and(eq(orders.id, id), inArray(orders.status, [...from])))
        .returning();
      return row ?? null;
    } catch (err: unknown) {
      if (patch.bkashTrxId && isUniqueViolation(err, TRX_ID_UNIQUE)) {
        throw new TrxIdAlreadyUsedError(patch.bkashTrxId);
      }
      throw err;
    }
  },

  listLapsedHolds(now, limit) {
    return db
      .select({ id: orders.id, ticketTypeId: orders.ticketTypeId, quantity: orders.quantity })
      .from(orders)
      .where(and(eq(orders.status, 'pending_payment'), lt(orders.holdExpiresAt, now)))
      .orderBy(asc(orders.holdExpiresAt))
      .limit(limit);
  },

  async listVerificationQueue() {
    const rows = await db
      .select({ order: orders, eventTitle: events.title, ticketTypeName: ticketTypes.name })
      .from(orders)
      .innerJoin(events, eq(orders.eventId, events.id))
      .innerJoin(ticketTypes, eq(orders.ticketTypeId, ticketTypes.id))
      .where(eq(orders.status, 'pending_verification'))
      .orderBy(asc(orders.updatedAt));
    return rows;
  },

  async countByStatus(status) {
    const [row] = await db.select({ n: count() }).from(orders).where(eq(orders.status, status));
    return row?.n ?? 0;
  },

  listByBuyerEmail(email) {
    return db
      .select({ order: orders, eventTitle: events.title, ticketTypeName: ticketTypes.name })
      .from(orders)
      .innerJoin(events, eq(orders.eventId, events.id))
      .innerJoin(ticketTypes, eq(orders.ticketTypeId, ticketTypes.id))
      .where(eq(orders.buyerEmail, email))
      .orderBy(desc(orders.createdAt));
  },

  async search(filter, page, sort = { column: 'created', desc: true }) {
    const where = searchWhere(filter);
    const [rows, [counted]] = await Promise.all([
      db
        .select({ order: orders, eventTitle: events.title, ticketTypeName: ticketTypes.name })
        .from(orders)
        .innerJoin(events, eq(orders.eventId, events.id))
        .innerJoin(ticketTypes, eq(orders.ticketTypeId, ticketTypes.id))
        .where(where)
        // The id tiebreak keeps pages stable when many rows share a value.
        .orderBy(...sortOrder(sort), desc(orders.id))
        .limit(page.limit)
        .offset(page.offset),
      db.select({ n: count() }).from(orders).where(where),
    ]);
    return { rows, total: counted?.n ?? 0 };
  },

  async totalsByStatus(filter) {
    const rows = await db
      .select({
        status: orders.status,
        n: count(),
        comp: sql<number>`(count(*) filter (where ${orders.complimentaryReason} is not null))::int`,
        paisa: sum(orders.totalPaisa),
      })
      .from(orders)
      .where(searchWhere({ ...filter, status: null }))
      .groupBy(orders.status);
    // sum() comes back as a string (bigint-safe); totals fit a number for
    // any plausible organizer (Number.MAX_SAFE_INTEGER paisa ≈ ৳90 trillion).
    return rows.map((r) => ({
      status: r.status,
      count: r.n,
      totalPaisa: Number(r.paisa ?? 0),
      compCount: r.comp,
    }));
  },
};

function sortOrder(sort: OrdersSort): SQL[] {
  const dir = sort.desc ? desc : asc;
  switch (sort.column) {
    case 'created':
      return [dir(orders.createdAt)];
    case 'total':
      return [dir(orders.totalPaisa)];
    case 'reference':
      return [dir(orders.reference)];
    case 'status':
      return [dir(orders.status)];
    case 'buyer':
      return [dir(orders.buyerName)];
  }
}

/**
 * The search term is pre-normalised (validation/orders-search.ts) so the
 * identifier matches are plain equality — they hit the unique indexes —
 * and only the email is a substring scan. An empty term means no term.
 */
function searchWhere(filter: OrdersSearchFilter): SQL | undefined {
  const clauses: SQL[] = [];
  const t = filter.term;
  if (t && (t.reference || t.trxId || t.phone || t.email)) {
    const alternatives: SQL[] = [];
    if (t.reference) alternatives.push(eq(orders.reference, t.reference));
    if (t.trxId) alternatives.push(eq(orders.bkashTrxId, t.trxId));
    if (t.phone) alternatives.push(eq(orders.buyerPhone, t.phone));
    if (t.email) alternatives.push(ilike(orders.buyerEmail, `%${escapeLike(t.email)}%`));
    clauses.push(or(...alternatives)!);
  }
  if (filter.status) clauses.push(eq(orders.status, filter.status));
  if (filter.eventId) clauses.push(eq(orders.eventId, filter.eventId));
  if (filter.createdFrom) clauses.push(gte(orders.createdAt, filter.createdFrom));
  if (filter.createdBefore) clauses.push(lt(orders.createdAt, filter.createdBefore));
  return clauses.length ? and(...clauses) : undefined;
}

/** `%` and `_` in a typed term must match literally, not as wildcards. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}
