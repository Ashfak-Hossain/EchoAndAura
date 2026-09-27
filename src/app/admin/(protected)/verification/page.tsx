import type { Metadata } from 'next';
import Link from 'next/link';
import { ordersService } from '@/server/container';
import { EmptyState } from '@/components/empty-state';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/page-header';
import { DataTable } from '@/components/admin/data-table';
import { parseSort, type SortState } from '@/lib/table-sort';
import { formatRelative } from '@/lib/time';
import { cn } from '@/lib/utils';
import { queueColumns, type QueueRowData } from './columns';

export const metadata: Metadata = { title: 'Verification' };
export const dynamic = 'force-dynamic';

const QUEUE_SORT_COLUMNS = ['submitted', 'amount', 'hold'] as const;
type QueueSortColumn = (typeof QUEUE_SORT_COLUMNS)[number];
/** Oldest submission first: the person who has waited longest is on top. */
const DEFAULT_SORT: SortState<QueueSortColumn> = { column: 'submitted', desc: false };

/** Under this, the hold column turns red (B7). */
const URGENT_HOLD_MS = 2 * 3_600_000;

function waited(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function holdIn(expiresAt: Date | null, now: Date): { text: string; urgent: boolean } {
  if (!expiresAt) return { text: '—', urgent: false };
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return { text: 'lapsed', urgent: true };
  return { text: `in ${waited(ms)}`, urgent: ms < URGENT_HOLD_MS };
}

// B7: oldest first — the person who has waited longest is always on top.
// No inline approve: approving needs amount and trxID side by side (B8).
export default async function VerificationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort: sortParam } = await searchParams;
  const sort = parseSort(sortParam, QUEUE_SORT_COLUMNS, DEFAULT_SORT);
  const queue = await ordersService.listVerificationQueue();
  const now = new Date();
  const oldest = queue[0] ? waited(now.getTime() - queue[0].submittedAt.getTime()) : null;

  // Unpaginated by design (tens of rows): sorted here on the server from the URL.
  const dir = sort.desc ? -1 : 1;
  const sorted = [...queue].sort((a, b) => {
    const cmp =
      sort.column === 'amount'
        ? a.order.totalPaisa - b.order.totalPaisa
        : sort.column === 'hold'
          ? (a.order.holdExpiresAt?.getTime() ?? Infinity) -
            (b.order.holdExpiresAt?.getTime() ?? Infinity)
          : a.submittedAt.getTime() - b.submittedAt.getTime();
    return dir * cmp;
  });
  const rows: QueueRowData[] = sorted.map(({ order, eventTitle, ticketTypeName, submittedAt }) => {
    const hold = holdIn(order.holdExpiresAt, now);
    return {
      id: order.id,
      reference: order.reference,
      buyerName: order.buyerName,
      buyerPhone: order.buyerPhone,
      ticketTypeName,
      quantity: order.quantity,
      eventTitle,
      totalPaisa: order.totalPaisa,
      trxId: order.bkashTrxId ?? '',
      sender: order.bkashSenderMsisdn ?? '',
      submittedLabel: formatRelative(submittedAt, now),
      holdLabel: hold.text,
      holdUrgent: hold.urgent,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Verification"
        subtitle={
          queue.length === 0 ? 'Nothing waiting' : `${queue.length} waiting · oldest ${oldest}`
        }
      />

      {queue.length === 0 ? (
        <EmptyState
          title="All clear — nothing to verify."
          icon="✓"
          description="New payments appear here within a minute of a buyer submitting a trxID."
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Sorted oldest first — the person who has waited longest is always on top.
          </p>

          {/* Desktop table (phone cards below) */}
          <DataTable
            tableId="verification"
            columns={queueColumns}
            data={rows}
            sort={sort}
            sortBase={{ pathname: '/admin/verification', query: '' }}
            rowTestId="queue-row"
          />

          {/* Phone cards */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {sorted.map(({ order, eventTitle, ticketTypeName, submittedAt }) => {
              const hold = holdIn(order.holdExpiresAt, now);
              return (
                <li key={order.id}>
                  <Link
                    href={`/admin/orders/${order.id}`}
                    className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 hover:border-border-strong"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono font-semibold">{order.reference}</span>
                      <span
                        className={cn(
                          'text-[13px] tabular',
                          hold.urgent ? 'font-semibold text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        Hold ends {hold.text}
                      </span>
                    </div>
                    <div className="text-[15px]">{order.buyerName}</div>
                    <div className="flex items-baseline justify-between gap-3">
                      <Money paisa={order.totalPaisa} className="text-lg font-semibold" />
                      <span className="text-[13px] text-muted-foreground">
                        {ticketTypeName} × {order.quantity}
                      </span>
                    </div>
                    <div className="font-mono text-[15px] tabular">{order.bkashTrxId}</div>
                    <div className="text-[13px] text-muted-foreground tabular">
                      Sent from {order.bkashSenderMsisdn} · {formatRelative(submittedAt, now)}
                    </div>
                    <div className="text-[13px] text-muted-foreground">{eventTitle}</div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
