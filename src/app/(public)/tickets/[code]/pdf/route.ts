import { ticketQrSvg } from '@/server/lib/qr';
import { qrSvgToPath, renderTicketPdf } from '@/server/pdf/ticket-pdf';
import { getSiteSettings } from '@/lib/settings';
import { siteUrl } from '@/lib/seo';
import { loadTicket } from '../load';

export const dynamic = 'force-dynamic';

/**
 * C5: the printable ticket, rendered on demand (a few KB per page, no
 * external I/O — see ADR-015). The whole order's tickets are in one file,
 * the requested one first: a buyer who opens ticket 2 still gets every
 * page they paid for.
 *
 * Rendering is CPU-bound and the path is unauthenticated (keyed by a
 * 40-bit code), so at most a couple render at once: a burst queues instead
 * of starving the order and verification pages. Rate limiting proper is
 * Phase 7.
 */
const MAX_CONCURRENT_RENDERS = 2;
let active = 0;
const waiting: (() => void)[] = [];
async function withRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_RENDERS) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const view = await loadTicket(code);
  const ordered = [view.ticket, ...view.siblings.filter((t) => t.id !== view.ticket.id)];

  const tickets = await Promise.all(
    ordered.map(async (t) => {
      const qr = qrSvgToPath(await ticketQrSvg(t.code));
      return {
        code: t.code,
        position: t.position,
        attendeeName: t.attendeeName,
        status: t.status,
        qrPath: qr.path,
        qrViewBox: qr.viewBox,
      };
    }),
  );

  const { supportEmail } = await getSiteSettings();
  const pdf = await withRenderSlot(() =>
    renderTicketPdf({
      eventTitle: view.event.title,
      startsAt: view.event.startsAt,
      endsAt: view.event.endsAt,
      venue: view.event.venue,
      ticketTypeName: view.ticketType.name,
      orderReference: view.order.reference,
      registrationClosesAt: view.event.registrationClosesAt,
      issuedAt: view.ticket.createdAt,
      contactEmail: supportEmail,
      siteHost: new URL(siteUrl()).host,
      tickets,
    }),
  );

  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${view.ticket.code}.pdf"`,
      // A rename is the only thing that changes the document.
      'Cache-Control': 'private, max-age=60',
      'X-Robots-Tag': 'noindex',
    },
  });
}
