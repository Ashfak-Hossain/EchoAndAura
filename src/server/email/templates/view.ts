import type { EventRecord } from '@/server/repositories/events.repository';
import type { OrderRecord } from '@/server/repositories/orders.repository';
import type { TicketTypeRecord } from '@/server/repositories/ticket-types.repository';
import type { TicketRecord } from '@/server/repositories/tickets.repository';

/** What the footer of every email says about who sent it (B14 settings). */
export interface EmailSender {
  siteUrl: string;
  contactEmail: string | null;
  contactPhone: string | null;
  /** "Raj" — how the organizer is named in the copy. */
  organizerName: string;
  organizerAddress: string | null;
}

/** Everything a template may read: the order view plus the site settings. */
export interface EmailView extends EmailSender {
  order: OrderRecord;
  event: EventRecord;
  ticketType: TicketTypeRecord;
  tickets: TicketRecord[];
  bkashNumber: string | null;
  bkashAccountName: string | null;
  /** "Send Money" (personal) vs "Payment" (merchant) in the payment steps. */
  bkashAccountType: 'personal' | 'merchant';
  /** "usually within 4 hours" */
  verificationPromise: string;
  /** Tickets still available for this type, for C3/C4's "still available". */
  availableNow: number;
  /** When the relevant thing happened (approval, rejection, expiry), for the copy. */
  at: Date;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** "+8801712345678" → "01712345678" as bKash shows it. */
export function localMsisdn(e164: string | null): string {
  return e164 ? e164.replace(/^\+880/, '0') : '—';
}
