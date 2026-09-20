import type { EventRecord } from '@/server/repositories/events.repository';
import type { OrderRecord } from '@/server/repositories/orders.repository';
import type { TicketTypeRecord } from '@/server/repositories/ticket-types.repository';
import type { TicketRecord } from '@/server/repositories/tickets.repository';

/** Everything a template may read: the order view plus environment facts. */
export interface EmailView {
  order: OrderRecord;
  event: EventRecord;
  ticketType: TicketTypeRecord;
  tickets: TicketRecord[];
  siteUrl: string;
  bkashNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** Tickets still available for this type, for C3/C4's "still available". */
  availableNow: number;
  /** When the relevant thing happened (approval, rejection, expiry), for the copy. */
  at: Date;
}

export const SLA_TEXT = 'usually within 4 hours';

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** "+8801712345678" → "01712345678" as bKash shows it. */
export function localMsisdn(e164: string | null): string {
  return e164 ? e164.replace(/^\+880/, '0') : '—';
}
