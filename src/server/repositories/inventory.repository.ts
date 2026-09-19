import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import type { DbExecutor } from '@/db/executor';
import { ticketTypes } from '@/db/schema';
import { InvalidQuantityError, InventoryStateError } from '@/server/lib/errors';
import { isCheckViolation } from '@/server/lib/pg-errors';

/**
 * The ONLY module that writes `quantity_reserved` and `quantity_sold`
 * (Invariant 2). Every method is one conditional UPDATE — the condition is
 * evaluated by Postgres against the row's current values under the row
 * lock, so two buyers can never both pass a check that only one of them
 * satisfies. There is no read-then-write anywhere in here.
 *
 * Each method takes the executor to run on: the pool, or the transaction a
 * service opened so the hold commits together with the order that owns it.
 */
export interface InventoryRepository {
  /**
   * Hold `quantity` tickets. Resolves false when fewer than `quantity` are
   * available — sold out is an ordinary outcome, not an error.
   */
  reserve(ticketTypeId: string, quantity: number, tx?: DbExecutor): Promise<boolean>;
  /**
   * Give `quantity` held tickets back (rejected / expired / cancelled hold).
   * @throws InventoryStateError when fewer than `quantity` are held.
   */
  release(ticketTypeId: string, quantity: number, tx?: DbExecutor): Promise<void>;
  /**
   * Turn `quantity` held tickets into sold ones (payment approved).
   * @throws InventoryStateError when fewer than `quantity` are held.
   */
  convertToSold(ticketTypeId: string, quantity: number, tx?: DbExecutor): Promise<void>;
}

// Constraint names as generated in drizzle/0000_*.sql. The CHECKs are the
// backstop: if the WHERE clause ever regressed, Postgres still refuses.
const AVAILABILITY_CHECK = 'ticket_types_availability_nonneg';
const RESERVED_CHECK = 'ticket_types_reserved_nonneg';

// Defence in depth. The service enforces the 1–10 business rule; the sole
// writer refuses anything that would move a counter the wrong way, because
// `reserve(-3)` would pass the availability WHERE trivially and silently free
// tickets that live orders still hold — the exact oversell Invariant 2 exists
// to prevent, and one no CHECK constraint would catch.
function assertPositiveInteger(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new InvalidQuantityError(quantity);
}

// `updated_at` is deliberately not bumped: it marks admin edits to the
// ticket type, and a counter moving on every order would drown that signal.
export const inventoryRepository: InventoryRepository = {
  async reserve(ticketTypeId, quantity, tx = db) {
    assertPositiveInteger(quantity);
    // UPDATE ticket_types SET quantity_reserved = quantity_reserved + $qty
    // WHERE id = $id AND quantity_total - quantity_sold - quantity_reserved >= $qty
    // RETURNING id
    const rows = await tx
      .update(ticketTypes)
      .set({
        quantityReserved: sql`${ticketTypes.quantityReserved} + ${quantity}`,
      })
      .where(
        and(
          eq(ticketTypes.id, ticketTypeId),
          sql`${ticketTypes.quantityTotal} - ${ticketTypes.quantitySold} - ${ticketTypes.quantityReserved} >= ${quantity}`,
        ),
      )
      .returning({ id: ticketTypes.id });
    return rows.length === 1;
  },

  async release(ticketTypeId, quantity, tx = db) {
    assertPositiveInteger(quantity);
    let rows: { id: string }[];
    try {
      rows = await tx
        .update(ticketTypes)
        .set({
          quantityReserved: sql`${ticketTypes.quantityReserved} - ${quantity}`,
        })
        .where(
          and(
            eq(ticketTypes.id, ticketTypeId),
            sql`${ticketTypes.quantityReserved} >= ${quantity}`,
          ),
        )
        .returning({ id: ticketTypes.id });
    } catch (err: unknown) {
      if (isCheckViolation(err, RESERVED_CHECK)) {
        throw new InventoryStateError(ticketTypeId, 'release');
      }
      throw err;
    }
    if (rows.length !== 1) throw new InventoryStateError(ticketTypeId, 'release');
  },

  async convertToSold(ticketTypeId, quantity, tx = db) {
    assertPositiveInteger(quantity);
    let rows: { id: string }[];
    try {
      rows = await tx
        .update(ticketTypes)
        .set({
          quantityReserved: sql`${ticketTypes.quantityReserved} - ${quantity}`,
          quantitySold: sql`${ticketTypes.quantitySold} + ${quantity}`,
        })
        .where(
          and(
            eq(ticketTypes.id, ticketTypeId),
            sql`${ticketTypes.quantityReserved} >= ${quantity}`,
          ),
        )
        .returning({ id: ticketTypes.id });
    } catch (err: unknown) {
      if (isCheckViolation(err, RESERVED_CHECK) || isCheckViolation(err, AVAILABILITY_CHECK)) {
        throw new InventoryStateError(ticketTypeId, 'convertToSold');
      }
      throw err;
    }
    if (rows.length !== 1) throw new InventoryStateError(ticketTypeId, 'convertToSold');
  },
};
