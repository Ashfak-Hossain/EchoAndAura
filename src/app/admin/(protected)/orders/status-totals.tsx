import Link from 'next/link';
import type { OrderTotals } from '@/server/services/orders.service';
import { Money } from '@/components/money';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/status-labels';
import { cn } from '@/lib/utils';

/** Tiles read in the order the state machine runs, not alphabetically. */
const STATUS_ORDER: OrderStatus[] = [
  'pending_payment',
  'pending_verification',
  'paid',
  'issued',
  'rejected',
  'expired',
  'cancelled',
];

const TONE: Record<OrderStatus, string> = {
  pending_payment: 'border-[#f0d9ac] bg-accent',
  pending_verification: 'border-[#c3d6ec] bg-info-tint',
  paid: 'border-[#bfe0cd] bg-success-tint',
  issued: 'border-[#bfe0cd] bg-success-tint',
  rejected: 'border-[#efc4c0] bg-destructive-tint',
  expired: 'border-border bg-secondary',
  cancelled: 'border-border bg-secondary',
};

/**
 * B9 status strip: counts and money per status for the current event /
 * date / search filters. Each tile links to the same URL with that status
 * set (the active one links back to "all"), so the strip is also the
 * status filter. Revenue counts paid + issued only; pending money is
 * "held"; cancelled is never called "refunded" — refunds happen outside
 * the app and the app cannot know them.
 */
export function StatusTotals({
  totals,
  active,
  hrefFor,
}: {
  totals: OrderTotals;
  active: OrderStatus | null;
  /** URL with `status` set (or cleared with null). */
  hrefFor: (status: OrderStatus | null) => string;
}) {
  const byStatus = new Map(totals.byStatus.map((t) => [t.status, t]));
  const present = STATUS_ORDER.filter((s) => byStatus.has(s));
  if (totals.count === 0) return null;

  return (
    <div
      className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]"
      data-testid="status-totals"
    >
      <Tile
        href={hrefFor(null)}
        active={active === null}
        label="All"
        count={totals.count}
        className="border-border-strong bg-card"
      />
      {present.map((s) => {
        const t = byStatus.get(s)!;
        const held = s === 'pending_payment' || s === 'pending_verification';
        return (
          <Tile
            key={s}
            href={active === s ? hrefFor(null) : hrefFor(s)}
            active={active === s}
            label={ORDER_STATUS_LABELS[s].label}
            count={t.count}
            money={t.totalPaisa}
            moneyNote={
              held
                ? 'held'
                : s === 'paid' || s === 'issued'
                  ? 'received'
                  : s === 'cancelled'
                    ? 'returned outside'
                    : 'not taken'
            }
            className={TONE[s]}
            testId={`status-tile-${s}`}
          />
        );
      })}
      <div
        className="flex h-23 flex-col justify-between rounded-xl border border-foreground bg-foreground px-4 py-3 text-background"
        data-testid="revenue-tile"
      >
        <span className="text-[12px] font-medium text-[#c9c3b7]">Revenue</span>
        <span className="font-heading text-[22px] leading-none font-semibold tabular">
          <Money paisa={totals.revenuePaisa} />
        </span>
        <span className="text-[12px] text-[#c9c3b7] tabular">
          {totals.revenueCount} paid {totals.revenueCount === 1 ? 'order' : 'orders'}
          {totals.compCount > 0 ? ` · ${totals.compCount} comp` : ''}
        </span>
      </div>
    </div>
  );
}

function Tile({
  href,
  active,
  label,
  count,
  money,
  moneyNote,
  className,
  testId,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
  money?: number;
  moneyNote?: string;
  className: string;
  testId?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      data-testid={testId}
      className={cn(
        'flex h-23 flex-col justify-between rounded-xl border px-4 py-3 transition-[border-color,box-shadow] hover:border-foreground',
        className,
        // Active = a 2px charcoal edge drawn inside the same box, so the tile
        // never grows or shifts its neighbours.
        active && 'border-foreground shadow-[inset_0_0_0_1px_#1c1a17]',
      )}
    >
      <span className="text-[12px] font-medium text-[#5c574c]">{label}</span>
      <span className="font-heading text-[22px] leading-none font-semibold tabular">{count}</span>
      <span className="text-[12px] text-[#5c574c] tabular">
        {money !== undefined ? (
          <>
            <Money paisa={money} /> {moneyNote}
          </>
        ) : (
          'all statuses'
        )}
      </span>
    </Link>
  );
}
