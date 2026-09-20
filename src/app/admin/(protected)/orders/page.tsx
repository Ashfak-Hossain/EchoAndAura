import type { Metadata } from 'next';
import Link from 'next/link';
import { eventsService, ordersService } from '@/server/container';
import { DataTable } from '@/components/admin/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { formatDhaka } from '@/lib/time';
import { ordersSearchSchema } from '@/lib/validation/orders-search';
import { orderColumns, type OrderRow } from './columns';
import { OrderCards } from './order-cards';
import { searchQuery, withStatus } from './query';
import { SearchForm } from './search-form';
import { StatusTotals } from './status-totals';

export const metadata: Metadata = { title: 'Orders' };
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// B9: status strip + search + filters + sortable table + pager, all from
// the URL. Thin: Zod → service → serialise rows for the client table.
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
  });
  const filtered = Boolean(input.q || input.status || input.event || input.from || input.to);

  const [result, totals, events] = await Promise.all([
    ordersService.searchOrders(input),
    ordersService.orderTotals(input),
    eventsService.listEvents(),
  ]);
  const { total, page, pageSize, pages } = result;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

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
      trxId: order.bkashTrxId,
      status: order.status,
      createdLabel: formatDhaka(order.createdAt),
      matchedField,
    }),
  );

  const query = searchQuery(input);

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
            : `${total} ${total === 1 ? 'order' : 'orders'}${filtered ? ' match' : ''}`
        }
      />

      <StatusTotals
        totals={totals}
        active={input.status}
        hrefFor={(status) => withStatus(input, status)}
      />

      <SearchForm input={input} events={events} exportHref={`/admin/orders/export.csv${query}`} />

      <p className="text-sm text-muted-foreground" data-testid="orders-summary">
        Search matches order reference, buyer email, phone or trxID.
        {input.q ? (
          <>
            {' '}
            Showing {total} {total === 1 ? 'result' : 'results'} for “{input.q}”.
          </>
        ) : null}
      </p>

      {rows.length === 0 ? (
        empty
      ) : (
        <>
          <DataTable
            tableId="orders"
            columns={orderColumns}
            data={rows}
            sort={input.sort}
            sortBase={{ pathname: '/admin/orders', query }}
            rowTestId="order-row"
          />
          <OrderCards rows={rows} />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span className="tabular">
              {from} – {to} of {total}
              {filtered ? (
                <>
                  {' · '}
                  <Link href="/admin/orders" className="underline underline-offset-2">
                    Clear search
                  </Link>
                </>
              ) : null}
            </span>
            {pages > 1 ? (
              <nav aria-label="Pagination" className="flex items-center gap-2">
                <PagerLink
                  href={`/admin/orders${searchQuery(input, page - 1)}`}
                  disabled={page <= 1}
                >
                  Previous
                </PagerLink>
                <span className="tabular">
                  {page} / {pages}
                </span>
                <PagerLink
                  href={`/admin/orders${searchQuery(input, page + 1)}`}
                  disabled={page >= pages}
                >
                  Next
                </PagerLink>
              </nav>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function PagerLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: string;
}) {
  const cls = 'inline-flex h-9 items-center rounded-lg border px-3.5 text-[13px] font-semibold';
  return disabled ? (
    <span aria-disabled="true" className={`${cls} border-border text-[#a8a29a]`}>
      {children}
    </span>
  ) : (
    <Link href={href} className={`${cls} border-border-strong bg-card hover:bg-secondary`}>
      {children}
    </Link>
  );
}
