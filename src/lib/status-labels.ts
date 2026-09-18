import { eventStatus, orderStatus, ticketStatus } from '@/db/schema';

/**
 * One vocabulary for every status chip (design S7). Labels are what Raj
 * reads; tones pick the tint/ink pair. Keyed by the real pgEnum values so a
 * new status cannot ship without a chip — tests/unit/status-labels.test.ts
 * asserts exhaustiveness.
 */

export type ChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export interface StatusLabel {
  label: string;
  tone: ChipTone;
}

export type EventStatus = (typeof eventStatus.enumValues)[number];
export type OrderStatus = (typeof orderStatus.enumValues)[number];
export type TicketStatus = (typeof ticketStatus.enumValues)[number];

export const EVENT_STATUS_LABELS: Record<EventStatus, StatusLabel> = {
  draft: { label: 'Draft', tone: 'neutral' },
  published: { label: 'Published', tone: 'success' },
  archived: { label: 'Archived', tone: 'neutral' },
};

// Buyer-facing wording (A4) and admin-facing (B7/B8) agree on these.
export const ORDER_STATUS_LABELS: Record<OrderStatus, StatusLabel> = {
  pending_payment: { label: 'Awaiting payment', tone: 'warning' },
  pending_verification: { label: 'Checking payment', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  issued: { label: 'Tickets issued', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  expired: { label: 'Expired', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, StatusLabel> = {
  issued: { label: 'Issued', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/**
 * Why a ticket type is not selling right now (B6 "row states"): out of
 * stock, sales not started, or the window is over. `null` = on sale.
 */
export type TicketTypeSaleState = 'sold_out' | 'opens_later' | 'window_ended';

export const TICKET_TYPE_SALE_STATE_LABELS: Record<TicketTypeSaleState, StatusLabel> = {
  sold_out: { label: 'Sold out', tone: 'danger' },
  opens_later: { label: 'Opens later', tone: 'info' },
  window_ended: { label: 'Window ended', tone: 'neutral' },
};

export function ticketTypeSaleState(
  t: {
    quantityTotal: number;
    quantitySold: number;
    quantityReserved: number;
    salesStartsAt: Date | null;
    salesEndsAt: Date | null;
  },
  now: Date,
): TicketTypeSaleState | null {
  if (t.quantityTotal - t.quantitySold - t.quantityReserved <= 0) return 'sold_out';
  if (t.salesStartsAt && t.salesStartsAt.getTime() > now.getTime()) return 'opens_later';
  if (t.salesEndsAt && t.salesEndsAt.getTime() <= now.getTime()) return 'window_ended';
  return null;
}
