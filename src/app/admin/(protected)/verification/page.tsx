import type { Metadata } from 'next';
import Link from 'next/link';
import { ordersService } from '@/server/container';
import { EmptyState } from '@/components/empty-state';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatRelative } from '@/lib/time';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Verification' };
export const dynamic = 'force-dynamic';

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
export default async function VerificationQueuePage() {
  const queue = await ordersService.listVerificationQueue();
  const now = new Date();
  const oldest = queue[0] ? waited(now.getTime() - queue[0].submittedAt.getTime()) : null;

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

          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference · buyer</TableHead>
                  <TableHead>Tickets</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>trxID</TableHead>
                  <TableHead>Sender</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Hold expires</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.map(({ order, eventTitle, ticketTypeName, submittedAt }) => {
                  const hold = holdIn(order.holdExpiresAt, now);
                  return (
                    <TableRow key={order.id} className="cursor-pointer" data-testid="queue-row">
                      <TableCell>
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="font-mono font-medium hover:underline"
                        >
                          {order.reference}
                        </Link>
                        <div className="text-[13px]">{order.buyerName}</div>
                        <div className="text-[13px] text-muted-foreground tabular">
                          {order.buyerPhone}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          {ticketTypeName} × {order.quantity}
                        </div>
                        <div className="text-[13px] text-muted-foreground">{eventTitle}</div>
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        <Money paisa={order.totalPaisa} />
                      </TableCell>
                      <TableCell className="font-mono">{order.bkashTrxId}</TableCell>
                      <TableCell className="tabular">{order.bkashSenderMsisdn}</TableCell>
                      <TableCell className="tabular">{formatRelative(submittedAt, now)}</TableCell>
                      <TableCell
                        className={cn('tabular', hold.urgent && 'font-semibold text-destructive')}
                      >
                        {hold.text}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Phone cards */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {queue.map(({ order, eventTitle, ticketTypeName, submittedAt }) => {
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
