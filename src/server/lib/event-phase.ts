import { ticketTypeSaleState } from '@/server/lib/ticket-type-sale-state';

/**
 * What the public event page is allowed to do right now (design A2). One pure
 * function decides the header block, the CTA and whether quantities are
 * shown, so the six page states can never disagree with each other.
 *
 * Precedence: past → closed → not_open → sold_out → closing_soon → open.
 */
export type EventPhase = 'not_open' | 'open' | 'closing_soon' | 'sold_out' | 'closed' | 'past';

/** Under this many hours to close, the countdown moves to the top of the page. */
export const CLOSING_SOON_HOURS = 48;

export interface EventPhaseInput {
  event: {
    startsAt: Date;
    registrationOpensAt: Date | null;
    registrationClosesAt: Date | null;
  };
  /** Sum of (total − sold − reserved) across ticket types. */
  availableTotal: number;
  now: Date;
}

export function eventPhase({ event, availableTotal, now }: EventPhaseInput): EventPhase {
  const t = now.getTime();
  if (event.startsAt.getTime() <= t) return 'past';
  // A missing bound is treated as "not yet configured" → not open. Publishing
  // requires both, so a published event always has them.
  if (!event.registrationOpensAt || !event.registrationClosesAt) return 'not_open';
  if (event.registrationClosesAt.getTime() <= t) return 'closed';
  if (event.registrationOpensAt.getTime() > t) return 'not_open';
  if (availableTotal <= 0) return 'sold_out';
  const hoursLeft = (event.registrationClosesAt.getTime() - t) / 3_600_000;
  if (hoursLeft < CLOSING_SOON_HOURS) return 'closing_soon';
  return 'open';
}

/** Availability wording for one ticket row (A2). */
export type TicketAvailability =
  | { kind: 'left'; count: number }
  | { kind: 'sold_out' }
  | { kind: 'closed' }
  | { kind: 'not_started' };

export function ticketAvailability(
  type: {
    quantityTotal: number;
    quantitySold: number;
    quantityReserved: number;
    salesStartsAt: Date | null;
    salesEndsAt: Date | null;
  },
  now: Date,
): TicketAvailability {
  switch (ticketTypeSaleState(type, now)) {
    case 'sold_out':
      return { kind: 'sold_out' };
    case 'window_ended':
      return { kind: 'closed' };
    case 'opens_later':
      return { kind: 'not_started' };
    default:
      return {
        kind: 'left',
        count: type.quantityTotal - type.quantitySold - type.quantityReserved,
      };
  }
}
