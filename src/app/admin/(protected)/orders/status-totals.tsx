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
    <div className="flex gap-2 overflow-x-auto pb-1" data-testid="status-totals">
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
            moneyNote={held ? 'held' : s === 'paid' || s === 'issued' ? 'received' : 'not taken'}
            className={TONE[s]}
            testId={`status-tile-${s}`}
          />
        );
      })}
      <div
        className="ml-auto flex min-w-37.5 shrink-0 flex-col gap-1 rounded-xl border border-foreground bg-foreground px-4 py-3 text-background"
        data-testid="revenue-tile"
      >
        <span className="text-[12px] font-medium text-[#c9c3b7]">Revenue</span>
        <span className="font-heading text-[22px] leading-none font-semibold tabular">
          <Money paisa={totals.revenuePaisa} />
        </span>
        <span className="text-[12px] text-[#c9c3b7] tabular">
          {totals.revenueCount} paid {totals.revenueCount === 1 ? 'order' : 'orders'}
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
        'flex min-w-35 shrink-0 flex-col gap-1 rounded-xl border px-4 py-3 transition-colors hover:border-foreground',
        className,
        active && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
      )}
    >
      <span className="text-[12px] font-medium text-[#5c574c]">{label}</span>
      <span className="font-heading text-[22px] leading-none font-semibold tabular">{count}</span>
      {money !== undefined ? (
        <span className="text-[12px] text-[#5c574c] tabular">
          <Money paisa={money} /> {moneyNote}
        </span>
      ) : (
        <span className="text-[12px] text-[#5c574c]">orders</span>
      )}
    </Link>
  );
}
