/**
 * Inventory reservation.
 *
 * The real implementation (Phase 3) is the single conditional atomic UPDATE
 * from CLAUDE.md Invariant 2 — never a read-then-write:
 *
 *   UPDATE ticket_types SET quantity_reserved = quantity_reserved + $qty
 *   WHERE id = $id AND quantity_total - quantity_sold - quantity_reserved >= $qty
 *   RETURNING id
 *
 * Zero rows returned means sold out. A CHECK constraint on ticket_types
 * backstops it at the database level.
 *
 * This is a typed stub so the whole project type-checks and `pnpm verify`
 * stays green, while tests/integration/inventory.concurrency.test.ts fails for
 * the right reason: the reservation logic is not implemented yet.
 *
 * @returns true if the requested quantity was reserved, false if sold out.
 */
export async function reserveTicketInventory(
  ticketTypeId: string,
  quantity: number,
): Promise<boolean> {
  void ticketTypeId;
  void quantity;
  throw new Error('reserveTicketInventory is not implemented yet (Phase 3)');
}
