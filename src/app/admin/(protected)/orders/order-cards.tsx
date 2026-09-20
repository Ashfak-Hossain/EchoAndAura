import Link from 'next/link';
import { Money } from '@/components/money';
import { StatusChip } from '@/components/status-chip';
import { cn } from '@/lib/utils';
import type { OrderRow } from './columns';

const hit = 'rounded bg-accent px-1 -mx-1';

/** Phone layout of the orders list: one card per order (the DataTable is desktop-only). */
export function OrderCards({ rows }: { rows: OrderRow[] }) {
  return (
    <ul className="flex flex-col gap-3 lg:hidden">
      {rows.map((o) => (
        <li key={o.id}>
          <Link
            href={`/admin/orders/${o.id}`}
            className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 hover:border-border-strong"
            data-testid="order-card"
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className={cn('font-mono font-semibold', o.matchedField === 'reference' && hit)}
              >
                {o.reference}
              </span>
              <StatusChip kind="order" status={o.status} />
            </div>
            <div className="text-[15px]">{o.buyerName}</div>
            <div className="text-[13px] text-muted-foreground">
              <span className={cn(o.matchedField === 'email' && hit)}>{o.buyerEmail}</span>
              {' · '}
              <span className={cn('tabular', o.matchedField === 'phone' && hit)}>
                {o.buyerPhone}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span>
                {o.ticketTypeName} × {o.quantity} · {o.eventTitle}
              </span>
              <Money paisa={o.totalPaisa} className="font-semibold" />
            </div>
            <div className="flex items-baseline justify-between gap-3 text-[13px] text-muted-foreground">
              <span className={cn('font-mono', o.matchedField === 'trxId' && hit)}>
                {o.trxId ?? '—'}
              </span>
              <span className="tabular">{o.createdLabel}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
