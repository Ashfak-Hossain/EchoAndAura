import Link from 'next/link';
import type { OrdersSearchRow } from '@/server/services/orders.service';
import { Money } from '@/components/money';
import { StatusChip } from '@/components/status-chip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDhaka } from '@/lib/time';
import { cn } from '@/lib/utils';

/** The cell that made this row a hit is tinted, so Raj sees why it matched. */
const hit = 'rounded bg-accent px-1 -mx-1';

export function OrdersTable({ rows }: { rows: OrdersSearchRow[] }) {
  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card shadow-sm lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead>Tickets</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>trxID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Created (Dhaka)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ order, eventTitle, ticketTypeName, matchedField }) => (
              <TableRow key={order.id} data-testid="order-row">
                <TableCell>
                  <Link
                    href={`/admin/orders/${order.id}`}
                    className={cn(
                      'font-mono font-medium hover:underline',
                      matchedField === 'reference' && hit,
                    )}
                  >
                    {order.reference}
                  </Link>
                </TableCell>
                <TableCell>
                  <div>{order.buyerName}</div>
                  <div
                    className={cn(
                      'text-[13px] text-muted-foreground',
                      matchedField === 'email' && hit,
                    )}
                  >
                    {order.buyerEmail}
                  </div>
                  <div
                    className={cn(
                      'text-[13px] text-muted-foreground tabular',
                      matchedField === 'phone' && hit,
                    )}
                  >
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
                <TableCell className="font-mono">
                  {order.bkashTrxId ? (
                    <span className={cn(matchedField === 'trxId' && hit)}>{order.bkashTrxId}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusChip kind="order" status={order.status} />
                </TableCell>
                <TableCell className="text-right text-[13px] text-muted-foreground tabular">
                  {formatDhaka(order.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Phone cards */}
      <ul className="flex flex-col gap-3 lg:hidden">
        {rows.map(({ order, eventTitle, ticketTypeName, matchedField }) => (
          <li key={order.id}>
            <Link
              href={`/admin/orders/${order.id}`}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 hover:border-border-strong"
              data-testid="order-card"
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  className={cn('font-mono font-semibold', matchedField === 'reference' && hit)}
                >
                  {order.reference}
                </span>
                <StatusChip kind="order" status={order.status} />
              </div>
              <div className="text-[15px]">{order.buyerName}</div>
              <div className="text-[13px] text-muted-foreground">
                <span className={cn(matchedField === 'email' && hit)}>{order.buyerEmail}</span>
                {' · '}
                <span className={cn('tabular', matchedField === 'phone' && hit)}>
                  {order.buyerPhone}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span>
                  {ticketTypeName} × {order.quantity} · {eventTitle}
                </span>
                <Money paisa={order.totalPaisa} className="font-semibold" />
              </div>
              <div className="flex items-baseline justify-between gap-3 text-[13px] text-muted-foreground">
                <span className={cn('font-mono', matchedField === 'trxId' && hit)}>
                  {order.bkashTrxId ?? '—'}
                </span>
                <span className="tabular">{formatDhaka(order.createdAt)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
