import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import type { DbExecutor } from '@/db/executor';
import { orderEvents, orders } from '@/db/schema';
import { OrderReferenceCollisionError } from '@/server/lib/errors';
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

export interface OrdersRepository {
  /** @throws OrderReferenceCollisionError when the reference is taken (retry with a new one). */
  insert(values: NewOrder, tx?: DbExecutor): Promise<OrderRecord>;
  /** Appends one audit row. Every status change writes one (Invariant 6). */
  insertEvent(values: NewOrderEvent, tx?: DbExecutor): Promise<OrderEventRecord>;
  findById(id: string): Promise<OrderRecord | null>;
  findByReference(reference: string): Promise<OrderRecord | null>;
  listEvents(orderId: string): Promise<OrderEventRecord[]>;
}

// Constraint name as generated in drizzle/0000_*.sql.
const REFERENCE_UNIQUE = 'orders_reference_unique';

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
};
