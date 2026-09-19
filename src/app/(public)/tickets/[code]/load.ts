import { notFound } from 'next/navigation';
import { cache } from 'react';
import { ticketsService } from '@/server/container';
import { TicketNotFoundError } from '@/server/lib/errors';
import { TICKET_CODE_PATTERN } from '@/server/lib/ticket-code';
import { normaliseTicketCode } from '@/server/services/tickets.service';

/** Shared by the page, the PDF and the calendar routes: one lookup per request. */
export const loadTicket = cache(async (rawCode: string) => {
  // Next has already decoded the segment; the pattern rejects anything odd.
  const code = normaliseTicketCode(rawCode);
  if (!TICKET_CODE_PATTERN.test(code)) notFound();
  try {
    return await ticketsService.getTicketByCode(code);
  } catch (err: unknown) {
    if (err instanceof TicketNotFoundError) notFound();
    throw err;
  }
});
