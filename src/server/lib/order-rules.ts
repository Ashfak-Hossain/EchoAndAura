/**
 * Order sizing rules shared by inventory, order creation and the Zod schema
 * at the boundary, so a limit is never restated with a different number.
 */

/** Business rule + ADR-002: caps the damage an abandoned hold can do. Also a DB CHECK. */
export const MAX_TICKETS_PER_ORDER = 10;

export const MIN_TICKETS_PER_ORDER = 1;

/** True for an integer quantity within the per-order limits. */
export function isValidOrderQuantity(quantity: number): boolean {
  return (
    Number.isInteger(quantity) &&
    quantity >= MIN_TICKETS_PER_ORDER &&
    quantity <= MAX_TICKETS_PER_ORDER
  );
}
