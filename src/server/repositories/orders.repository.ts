import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import type { DbExecutor } from '@/db/executor';
import { orderEvents, orders } from '@/db/schema';
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
  Pick<NewOrder, 'bkashTrxId' | 'bkashSenderMsisdn' | 'holdExpiresAt'>
>;

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
    const [row] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
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
};
