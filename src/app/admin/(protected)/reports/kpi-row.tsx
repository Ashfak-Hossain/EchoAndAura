import Link from 'next/link';
import { dhakaDaysUntil, inDays, type Delta } from '@/server/lib/sales-report';
import type { SalesReport } from '@/server/services/reports.service';
import { formatBDT } from '@/server/lib/money';
import { CountUp } from '@/components/admin/count-up';
import { StatCard } from '@/components/stat-card';
import { cn } from '@/lib/utils';
import { formatCount, formatSigned } from './report-card';

/**
 * B12 KPI row. Every number is defined the same way as on the Orders
 * screen: revenue is verified money only, pending is held (not earned),
 * seats come from the inventory counters. A delta compares the selected
 * window with the same number of days before it — never shown for "All".
 */
export function KpiRow({ report }: { report: SalesReport }) {
  const { seats, revenue, pending, period, window, event, pace7 } = report;
  const days = `${window.days}d`;
  const closes = event.registrationClosesAt;
  const now = report.generatedAt;
  const soldOut = seats.total > 0 && seats.left === 0 && seats.held === 0;

  let seatsDetail: string;
  if (soldOut) seatsDetail = 'Sold out';
  else if (closes && closes.getTime() > now.getTime()) {
    seatsDetail = `registration closes ${inDays(dhakaDaysUntil(closes, now))} · ${pace7}/day this week`;
  } else if (closes) seatsDetail = 'registration closed';
  else seatsDetail = `${pace7}/day this week`;

  // B13: a fifth card once the event has comps — seats given away, never money.
  const comp = report.complimentary;
  const hasComps = comp.orders > 0;

  return (
    <div
      className={cn('grid gap-4 sm:grid-cols-2', hasComps ? 'xl:grid-cols-5' : 'xl:grid-cols-4')}
      data-testid="kpi-row"
    >
      <StatCard
        label="Tickets sold"
        value={<CountUp value={seats.sold} className="tabular" data-testid="kpi-sold" />}
        detail={
          <Detail
            text={`of ${formatCount(seats.total)} · ${seats.soldPct}%`}
            delta={period.tickets}
            days={days}
          />
        }
      />
      <StatCard
        label="Revenue"
        value={<CountUp value={revenue.paisa} money className="tabular" />}
        detail={
          <Detail
            text={`verified only · ${formatCount(revenue.orders)} ${revenue.orders === 1 ? 'order' : 'orders'}`}
            delta={period.paisa}
            days={days}
            money
          />
        }
      />
      <StatCard
        label="Pending"
        value={<CountUp value={pending.paisa} money className="tabular" />}
        urgent={pending.toVerify > 0}
        detail={
          pending.orders === 0 ? (
            'Nothing waiting'
          ) : (
            <>
              {formatCount(pending.orders)} {pending.orders === 1 ? 'order' : 'orders'} waiting
              {pending.toVerify > 0 ? (
                <>
                  {' · '}
                  <Link href="/admin/verification" className="underline">
                    {formatCount(pending.toVerify)} to verify →
                  </Link>
                </>
              ) : null}
            </>
          )
        }
        detailTone={pending.orders === 0 ? 'success' : 'muted'}
      />
      <StatCard
        label="Seats left"
        value={<CountUp value={seats.left} className="tabular" data-testid="kpi-left" />}
        detail={seatsDetail}
        detailTone={soldOut ? 'success' : 'muted'}
      />
      {hasComps ? (
        <StatCard
          label="Complimentary"
          value={<CountUp value={comp.tickets} className="tabular" data-testid="kpi-comp" />}
          detail={`${comp.tickets === 1 ? 'ticket' : 'tickets'} at ${formatBDT(0)} · in Tickets sold, not in Revenue`}
        />
      ) : null}
    </div>
  );
}

function Detail({
  text,
  delta,
  days,
  money,
}: {
  text: string;
  delta: Delta | null;
  days: string;
  money?: boolean;
}) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span>{text}</span>
      {delta ? <DeltaChip delta={delta} days={days} money={money} /> : null}
    </span>
  );
}

/**
 * "▲ +62 verified in 14d" against the prior window; grey when nothing changed
 * or there was no prior. Verified quantity is gross (a partially cancelled
 * order keeps its quantity), which is why the chip says "verified", not "sold".
 */
function DeltaChip({ delta, days, money }: { delta: Delta; days: string; money?: boolean }) {
  const up = delta.change > 0;
  const down = delta.change < 0;
  const sign = up ? '+' : down ? '−' : '';
  const amount = money ? `${sign}${formatBDT(Math.abs(delta.change))}` : formatSigned(delta.change);
  const vs =
    delta.pct === null
      ? delta.current > 0
        ? 'new'
        : ''
      : `${delta.pct > 0 ? '+' : ''}${delta.pct}%`;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular',
        up && 'bg-success-tint text-[#17603b]',
        down && 'bg-destructive-tint text-[#8e1e17]',
        !up && !down && 'bg-secondary text-[#5c574c]',
      )}
      title={`${money ? formatBDT(delta.current) : formatCount(delta.current)} verified in the last ${days} vs ${money ? formatBDT(delta.prior) : formatCount(delta.prior)} in the ${days} before`}
    >
      <span aria-hidden="true">{up ? '▲' : down ? '▼' : '–'}</span>
      {amount} verified in {days}
      {vs ? <span className="font-medium opacity-80">({vs})</span> : null}
    </span>
  );
}
