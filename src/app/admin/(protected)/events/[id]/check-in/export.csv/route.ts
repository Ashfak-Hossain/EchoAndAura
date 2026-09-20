import { z } from 'zod';
import { ticketsService } from '@/server/container';
import { toCsv } from '@/server/lib/csv';
import { EventNotFoundError } from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import { requireAdmin } from '@/lib/session';
import { DHAKA_TZ } from '@/lib/time';
import { checkInQuerySchema } from '@/lib/validation/check-in';
import { formatInTimeZone } from 'date-fns-tz';

export const dynamic = 'force-dynamic';

/**
 * B11 "Export CSV": the door list as a download — the same search and
 * order as the page, plus an empty `checked_in` column to tick in a
 * spreadsheet. A route handler is its own endpoint, so the admin check is
 * here, not only in the layout (ADR-017).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response('Not found', { status: 404 });
  const search = new URL(request.url).searchParams;
  const input = checkInQuerySchema.parse({
    q: search.get('q') ?? undefined,
    sort: search.get('sort') ?? undefined,
  });

  let list;
  try {
    list = await ticketsService.checkInList(id, input);
  } catch (err: unknown) {
    if (err instanceof EventNotFoundError) return new Response('Not found', { status: 404 });
    throw err;
  }

  const header = ['attendee_name', 'ticket_type', 'ticket_code', 'order_reference', 'checked_in'];
  const body = list.rows.map((r) => [
    r.attendeeName,
    r.ticketTypeName,
    r.code,
    r.orderReference,
    '',
  ]);

  // The term is usually an attendee's name: log that a filter was used, not what.
  logger.info(
    { actor: admin.email, eventId: id, rows: body.length, filtered: Boolean(input.q) },
    'check-in list exported',
  );
  const stamp = formatInTimeZone(new Date(), DHAKA_TZ, 'yyyyMMdd-HHmm');
  return new Response(toCsv(header, body), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="check-in-${list.event.slug}-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
