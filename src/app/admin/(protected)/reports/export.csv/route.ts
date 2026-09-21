import { formatInTimeZone } from 'date-fns-tz';
import { reportsService } from '@/server/container';
import { toCsv, type CsvValue } from '@/server/lib/csv';
import { EventNotFoundError } from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import { formatDecimalBDT } from '@/server/lib/money';
import { defaultReportEvent } from '@/server/lib/sales-report';
import { EVENT_STATUS_LABELS } from '@/lib/status-labels';
import { requireAdmin } from '@/lib/session';
import { DHAKA_TZ } from '@/lib/time';
import { reportsQuerySchema } from '@/lib/validation/reports';

export const dynamic = 'force-dynamic';

/**
 * B12 "Export CSV": three sheets from the same report — the ticket-type
 * summary (what an accountant wants), the daily series for the selected
 * period, and the all-events overview. Money is a plain decimal so the
 * column sums in a spreadsheet. A route handler is its own endpoint, so
 * the admin check is here, not only in the layout (ADR-017).
 */
export async function GET(request: Request): Promise<Response> {
  const admin = await requireAdmin();
  const search = new URL(request.url).searchParams;
  const input = reportsQuerySchema.parse({
    event: search.get('event') ?? undefined,
    range: search.get('range') ?? undefined,
    section: search.get('section') ?? undefined,
  });

  const overview = await reportsService.overview();
  const eventId =
    input.event ??
    defaultReportEvent(
      overview.map((r) => r.event),
      new Date(),
    )?.id;
  if (!eventId) return new Response('Not found', { status: 404 });

  let report;
  try {
    report = await reportsService.salesReport(eventId, input.range);
  } catch (err: unknown) {
    if (err instanceof EventNotFoundError) return new Response('Not found', { status: 404 });
    throw err;
  }

  let header: string[];
  let body: CsvValue[][];
  if (input.section === 'daily') {
    header = ['date', 'orders', 'tickets_verified', 'revenue_bdt', 'tickets_verified_to_date'];
    body = report.daily.points.map((p, i) => [
      p.day,
      p.orders,
      p.tickets,
      formatDecimalBDT(p.paisa),
      report.cumulative.points[i]?.cumulative ?? 0,
    ]);
  } else if (input.section === 'overview') {
    header = [
      'event',
      'status',
      'starts_dhaka',
      'seats',
      'sold',
      'held',
      'revenue_bdt',
      'verified_orders',
      'pending_bdt',
      'pending_orders',
    ];
    body = overview.map((r) => [
      r.event.title,
      EVENT_STATUS_LABELS[r.event.status].label,
      formatInTimeZone(r.event.startsAt, DHAKA_TZ, 'yyyy-MM-dd HH:mm'),
      r.seats.total,
      r.seats.sold,
      r.seats.held,
      formatDecimalBDT(r.revenuePaisa),
      r.revenueOrders,
      formatDecimalBDT(r.pendingPaisa),
      r.pendingOrders,
    ]);
  } else {
    header = [
      'ticket_type',
      'unit_price_bdt',
      'seats',
      'sold',
      'held',
      'available',
      'verified_orders',
      'revenue_bdt',
      'discounts_bdt',
    ];
    const rows = report.byTicketType;
    body = rows.map((t) => [
      t.name,
      formatDecimalBDT(t.pricePaisa),
      t.quantityTotal,
      t.quantitySold,
      t.quantityReserved,
      Math.max(0, t.quantityTotal - t.quantitySold - t.quantityReserved),
      t.orderCount,
      formatDecimalBDT(t.revenuePaisa),
      formatDecimalBDT(t.discountPaisa),
    ]);
    const sum = (f: (t: (typeof rows)[number]) => number) => rows.reduce((n, t) => n + f(t), 0);
    body.push([
      'Total',
      '',
      sum((t) => t.quantityTotal),
      sum((t) => t.quantitySold),
      sum((t) => t.quantityReserved),
      sum((t) => Math.max(0, t.quantityTotal - t.quantitySold - t.quantityReserved)),
      sum((t) => t.orderCount),
      formatDecimalBDT(report.revenue.paisa),
      formatDecimalBDT(report.revenue.discountPaisa),
    ]);
  }

  logger.info(
    { actor: admin.email, eventId, section: input.section, range: input.range, rows: body.length },
    'sales report exported',
  );
  const stamp = formatInTimeZone(new Date(), DHAKA_TZ, 'yyyyMMdd-HHmm');
  return new Response(toCsv(header, body), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="sales-${report.event.slug}-${input.section}-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
