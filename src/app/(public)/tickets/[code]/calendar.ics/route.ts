import { buildTicketIcs } from '@/server/lib/ics';
import { siteUrl } from '@/lib/seo';
import { loadTicket } from '../load';

export const dynamic = 'force-dynamic';

/** A5 "Add to calendar". */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const view = await loadTicket(code);
  const ics = buildTicketIcs({
    code: view.ticket.code,
    eventTitle: view.event.title,
    venue: view.event.venue,
    startsAt: view.event.startsAt,
    endsAt: view.event.endsAt,
    url: `${siteUrl()}/tickets/${view.ticket.code}`,
    attendeeName: view.ticket.attendeeName,
  });
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${view.ticket.code}.ics"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
