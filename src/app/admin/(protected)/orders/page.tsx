import type { Metadata } from 'next';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { eventsService, ordersService } from '@/server/container';
import { DataTable } from '@/components/admin/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { formatDhaka } from '@/lib/time';
import { ordersSearchSchema } from '@/lib/validation/orders-search';
import { orderColumns, type OrderRow } from './columns';
import { OrderCards } from './order-cards';
import { OrdersToolbar } from './orders-toolbar';
import { searchQuery, withStatus } from './query';
import { StatusTotals } from './status-totals';

export const metadata: Metadata = { title: 'Orders' };
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// B9: status strip + toolbar (search, filters) + sortable table + pager,
// all from the URL. Thin: Zod → service → serialise rows for the client table.
export default async function AdminOrdersPage({ searchParams }: Props) {
  const raw = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const input = ordersSearchSchema.parse({
    q: first(raw.q),
    status: first(raw.status),
    event: first(raw.event),
    from: first(raw.from),
    to: first(raw.to),
    page: first(raw.page),
    sort: first(raw.sort),
    size: first(raw.size),
  });
  const filtered = Boolean(input.q || input.status || input.event || input.from || input.to);

  const [result, totals, events] = await Promise.all([
    ordersService.searchOrders(input),
    ordersService.orderTotals(input),
    eventsService.listEvents(),
  ]);
  const { total, page, pageSize, pages } = result;

  const rows: OrderRow[] = result.rows.map(
    ({ order, eventTitle, ticketTypeName, matchedField }) => ({
      id: order.id,
      reference: order.reference,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      buyerPhone: order.buyerPhone,
      ticketTypeName,
      quantity: order.quantity,
      eventTitle,
      totalPaisa: order.totalPaisa,
      complimentary: order.complimentaryReason !== null,
      trxId: order.bkashTrxId,
      status: order.status,
      createdLabel: formatDhaka(order.createdAt),
      matchedField,
    }),
  );

  const query = searchQuery(input);
  const exportHref = `/admin/orders/export.csv${query}`;
  const toolbarEvents = events.map((e) => ({ id: e.id, title: e.title }));

  const empty = filtered ? (
    <EmptyState
      icon="⌕"
      title={input.q ? `No orders match “${input.q}”` : 'No orders match these filters'}
      description={
        input.q
          ? 'Check the number, or search by order reference instead.'
          : 'Widen the date range or clear the status and event filters.'
      }
      action={
        <Link href="/admin/orders" className="text-sm font-semibold underline underline-offset-2">
          Clear filters
        </Link>
      }
    />
  ) : (
    <EmptyState
      icon="—"
      title="No orders yet"
      description="Orders appear here the moment someone registers for an event."
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Orders"
        subtitle={
          total === 0 && !filtered
            ? 'No orders yet'
            : `${total} ${total === 1 ? 'order' : 'orders'}${filtered ? ' match' : ''}${
                input.q ? ` for “${input.q}”` : ''
              }`
        }
      />

      <StatusTotals
        totals={totals}
        active={input.status}
        hrefFor={(status) => withStatus(input, status)}
      />

      <DataTable
        tableId="orders"
        columns={orderColumns}
        data={rows}
        sort={input.sort}
        sortBase={{ pathname: '/admin/orders', query }}
        toolbar={<OrdersToolbar events={toolbarEvents} />}
        actions={
          <Link
            href={exportHref}
            prefetch={false}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-card px-3.5 text-[13px] font-semibold hover:bg-secondary"
          >
            <Download className="size-3.5" aria-hidden="true" />
            Export CSV
          </Link>
        }
        pagination={{
          page,
          pages,
          total,
          size: pageSize,
          from: total === 0 ? 0 : (page - 1) * pageSize + 1,
          to: Math.min(total, page * pageSize),
        }}
        rowTestId="order-row"
        empty={empty}
      />

      {/* Phone layout: the same toolbar, then cards. */}
      <div className="flex flex-col gap-4 lg:hidden">
        <OrdersToolbar events={toolbarEvents} />
        {rows.length === 0 ? empty : <OrderCards rows={rows} />}
        {pages > 1 ? (
          <p className="text-center text-sm text-muted-foreground tabular">
            Page {page} of {pages}
            {page > 1 ? (
              <>
                {' · '}
                <Link href={`/admin/orders${searchQuery(input, page - 1)}`} className="underline">
                  Previous
                </Link>
              </>
            ) : null}
            {page < pages ? (
              <>
                {' · '}
                <Link href={`/admin/orders${searchQuery(input, page + 1)}`} className="underline">
                  Next
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
