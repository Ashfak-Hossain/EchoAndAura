import { assertValidPaisa, multiplyPaisa, sumPaisa } from '@/server/lib/money';

/**
 * Order totals (Invariant 5). The ONLY place an order's money is computed.
 * Inputs come from the ticket_types row and (Phase 5) the promo_codes row —
 * never from the request body. Every value is integer paisa (Invariant 1).
 */
export interface OrderTotalsInput {
  unitPricePaisa: number;
  quantity: number;
  /** Discount already worked out from the promo rule, in paisa. 0 = none. */
  discountPaisa?: number;
}

export interface OrderTotals {
  unitPricePaisa: number;
  quantity: number;
  subtotalPaisa: number;
  discountPaisa: number;
  totalPaisa: number;
}

export function computeOrderTotals({
  unitPricePaisa,
  quantity,
  discountPaisa = 0,
}: OrderTotalsInput): OrderTotals {
  const subtotalPaisa = multiplyPaisa(unitPricePaisa, quantity);
  assertValidPaisa(discountPaisa);
  // A fixed-amount code larger than the order never produces a negative
  // total or a credit — it is capped at what the order is worth.
  const applied = Math.min(discountPaisa, subtotalPaisa);
  const totalPaisa = sumPaisa(subtotalPaisa) - applied;
  assertValidPaisa(totalPaisa);
  return { unitPricePaisa, quantity, subtotalPaisa, discountPaisa: applied, totalPaisa };
}
