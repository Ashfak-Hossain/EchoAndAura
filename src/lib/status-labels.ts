import { eventStatus, orderStatus, ticketStatus } from '@/db/schema';

/**
 * One vocabulary for every status chip (design S7). Labels are what Raj
 * reads; tones pick the tint/ink pair. Keyed by the real pgEnum values so a
 * new status cannot ship without a chip — tests/unit/status-labels.test.ts
 * asserts exhaustiveness.
 */

export type ChipTone =
  | 'neutral'
  | 'neutralStrong'
  | 'draft'
  | 'success'
  | 'successSolid'
  | 'warning'
  | 'info'
  | 'danger'
  | 'accent';

export interface StatusLabel {
  label: string;
  tone: ChipTone;
  /** S7: payment states carry a 7px dot. */
  dot?: boolean;
  /** S7: Cancelled is struck through. */
  strike?: boolean;
}

export type EventStatus = (typeof eventStatus.enumValues)[number];
export type OrderStatus = (typeof orderStatus.enumValues)[number];
export type TicketStatus = (typeof ticketStatus.enumValues)[number];

export const EVENT_STATUS_LABELS: Record<EventStatus, StatusLabel> = {
  draft: { label: 'Draft', tone: 'draft' },
  published: { label: 'Published', tone: 'success' },
  archived: { label: 'Archived', tone: 'neutralStrong' },
};

// Buyer-facing wording (A4) and admin-facing (B7/B8) agree on these.
export const ORDER_STATUS_LABELS: Record<OrderStatus, StatusLabel> = {
  pending_payment: { label: 'Awaiting payment', tone: 'warning', dot: true },
  pending_verification: { label: 'Checking payment', tone: 'info', dot: true },
  paid: { label: 'Paid', tone: 'success', dot: true },
  issued: { label: 'Tickets issued', tone: 'successSolid' },
  rejected: { label: 'Rejected', tone: 'danger' },
  expired: { label: 'Expired', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral', strike: true },
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, StatusLabel> = {
  issued: { label: 'Issued', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral', strike: true },
};

import { type TicketTypeSaleState, ticketTypeSaleState } from '@/server/lib/ticket-type-sale-state';

export { type TicketTypeSaleState, ticketTypeSaleState };

export const TICKET_TYPE_SALE_STATE_LABELS: Record<TicketTypeSaleState, StatusLabel> = {
  sold_out: { label: 'Sold out', tone: 'neutral' },
  opens_later: { label: 'Opens later', tone: 'info' },
  window_ended: { label: 'Window ended', tone: 'neutral' },
};
