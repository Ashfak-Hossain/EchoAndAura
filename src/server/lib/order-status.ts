import { orderStatus } from '@/db/schema';
import { InvalidOrderTransitionError } from '@/server/lib/errors';

/**
 * Order state machine, straight from CLAUDE.md:
 *
 *   pending_payment → pending_verification → paid → issued
 *                                          ↘ rejected
 *                                          ↘ expired   (24h TTL)
 *                           issued → cancelled
 *
 * The enum bounds the values; this table bounds the moves. Every status
 * *change* goes through a service that calls `assertOrderTransition` first
 * and writes an `order_events` row (Invariant 6). A write that keeps the
 * status (re-submitting a trxID while `pending_verification`, ADR-013) is
 * not a transition and still writes its audit row. Terminal states have no
 * exits: a rejected, expired or cancelled order is never revived — the
 * buyer registers again and money is sorted out by hand (ADR-001).
 *
 * `pending_payment → expired` is what the expiry job uses: the buyer never
 * submitted a trxID. `pending_verification → expired` is legal for an admin
 * acting by hand on a stale claim, but the **expiry job must never take
 * it** (ADR-012): a trxID means real money may have been sent, and only a
 * person can resolve that — Approve or Reject, never the clock.
 */

export type OrderStatus = (typeof orderStatus.enumValues)[number];

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending_payment: ['pending_verification', 'expired'],
  pending_verification: ['paid', 'rejected', 'expired'],
  paid: ['issued'],
  issued: ['cancelled'],
  rejected: [],
  expired: [],
  cancelled: [],
};

export function isOrderTransitionAllowed(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** @throws InvalidOrderTransitionError */
export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!isOrderTransitionAllowed(from, to)) throw new InvalidOrderTransitionError(from, to);
}

/** Statuses in which inventory is still held for the order. */
export function holdsInventory(status: OrderStatus): boolean {
  return status === 'pending_payment' || status === 'pending_verification';
}
