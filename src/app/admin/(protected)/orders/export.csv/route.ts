import { ordersService } from '@/server/container';
import { ORDERS_EXPORT_CAP } from '@/server/services/orders.service';
import { toCsv } from '@/server/lib/csv';
import { formatDecimalBDT } from '@/server/lib/money';
import { logger } from '@/server/lib/logger';
import { requireAdmin } from '@/lib/session';
import { ORDER_STATUS_LABELS } from '@/lib/status-labels';
import { DHAKA_TZ, formatDhaka } from '@/lib/time';
import { ordersSearchSchema } from '@/lib/validation/orders-search';
import { formatInTimeZone } from 'date-fns-tz';

export const dynamic = 'force-dynamic';

/**
 * B9 "Export CSV": the same filters as the list, every matching row (up to
 * the cap), as a download. Route handlers are their own endpoints, so the
 * admin check is here, not only in the layout.
 */
export async function GET(request: Request): Promise<Response> {
  const admin = await requireAdmin();
  const params = new URL(request.url).searchParams;
  const input = ordersSearchSchema.parse({
    q: params.get('q') ?? undefined,
    status: params.get('status') ?? undefined,
    event: params.get('event') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    sort: params.get('sort') ?? undefined,
  });

  const { rows, total } = await ordersService.exportOrders(input);
  const header = [
    'reference',
    'status',
    'event',
    'ticket_type',
    'quantity',
    'total_bdt',
    'buyer_name',
    'buyer_email',
    'buyer_phone',
    'bkash_trx_id',
    'bkash_sender',
    'created_dhaka',
    'updated_dhaka',
  ];
  const body = rows.map(({ order, eventTitle, ticketTypeName }) => [
    order.reference,
    ORDER_STATUS_LABELS[order.status].label,
    eventTitle,
    ticketTypeName,
    order.quantity,
    formatDecimalBDT(order.totalPaisa),
    order.buyerName,
    order.buyerEmail,
    order.buyerPhone,
    order.bkashTrxId,
    order.bkashSenderMsisdn,
    formatDhaka(order.createdAt),
    formatDhaka(order.updatedAt),
  ]);
  if (total > ORDERS_EXPORT_CAP) {
    body.push([`Export capped at ${ORDERS_EXPORT_CAP} of ${total} rows — narrow the filters.`]);
  }

  logger.info({ actor: admin.email, rows: rows.length, total, input }, 'orders exported');
  const stamp = formatInTimeZone(new Date(), DHAKA_TZ, 'yyyyMMdd-HHmm');
  return new Response(toCsv(header, body), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="orders-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
