import type { DbExecutor } from '@/db/executor';
import { InvalidQuantityError } from '@/server/lib/errors';
import { isValidOrderQuantity } from '@/server/lib/order-rules';
import type { InventoryRepository } from '@/server/repositories/inventory.repository';

/**
 * Inventory holds (Invariant 2, ADR-011). The repository is the single
 * conditional atomic UPDATE:
 *
 *   UPDATE ticket_types SET quantity_reserved = quantity_reserved + $qty
 *   WHERE id = $id AND quantity_total - quantity_sold - quantity_reserved >= $qty
 *   RETURNING id
 *
 * Zero rows returned means sold out. A CHECK constraint backstops it.
 *
 * This service only guards the *quantity* rule and returns the outcome.
 * Whether a buyer may hold at all — event published, registration open,
 * ticket type on sale — is the order service's decision, made before it
 * calls `hold` inside the same transaction that inserts the order.
 */
export function createInventoryService(repo: InventoryRepository) {
  function assertQuantity(quantity: number): void {
    if (!isValidOrderQuantity(quantity)) throw new InvalidQuantityError(quantity);
  }

  return {
    /**
     * Hold `quantity` tickets of a type. Resolves false when sold out — a
     * value, not an exception, because it is an expected outcome the page
     * must explain. @throws InvalidQuantityError
     */
    async hold(ticketTypeId: string, quantity: number, tx?: DbExecutor): Promise<boolean> {
      assertQuantity(quantity);
      return repo.reserve(ticketTypeId, quantity, tx);
    },

    /**
     * Return held tickets (order rejected, expired or cancelled).
     * @throws InvalidQuantityError, InventoryStateError
     */
    async release(ticketTypeId: string, quantity: number, tx?: DbExecutor): Promise<void> {
      assertQuantity(quantity);
      await repo.release(ticketTypeId, quantity, tx);
    },

    /**
     * Held → sold on approval. Only fulfilment.service.ts may call this
     * (Invariant 4). @throws InvalidQuantityError, InventoryStateError
     */
    async convertToSold(ticketTypeId: string, quantity: number, tx?: DbExecutor): Promise<void> {
      assertQuantity(quantity);
      await repo.convertToSold(ticketTypeId, quantity, tx);
    },

    /**
     * A sold seat goes back on sale (ticket cancelled after issue). Not
     * `release`: that counter is what unpaid orders hold. Only
     * fulfilment.service.ts may call this. @throws InvalidQuantityError,
     * InventoryStateError
     */
    async releaseSold(ticketTypeId: string, quantity: number, tx?: DbExecutor): Promise<void> {
      assertQuantity(quantity);
      await repo.releaseSold(ticketTypeId, quantity, tx);
    },
  };
}

export type InventoryService = ReturnType<typeof createInventoryService>;

/**
 * @internal Test seam — application code uses `inventoryService` from the
 * container. The function `tests/integration/inventory.concurrency.test.ts` has called
 * since Phase 0 — kept so the most important test in the repo never needs
 * editing. Bound to the real repository on first call: the repository module
 * imports `db/client`, which requires DATABASE_URL at import time, and a
 * static import here would drag that requirement into every unit test that
 * loads this service.
 *
 * @returns true if the requested quantity was reserved, false if sold out.
 */
export async function reserveTicketInventory(
  ticketTypeId: string,
  quantity: number,
): Promise<boolean> {
  const { inventoryRepository } = await import('@/server/repositories/inventory.repository');
  return createInventoryService(inventoryRepository).hold(ticketTypeId, quantity);
}
