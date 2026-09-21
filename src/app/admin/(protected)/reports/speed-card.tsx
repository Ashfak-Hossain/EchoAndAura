import { formatBDT } from '@/server/lib/money';
import { formatDuration } from '@/server/lib/sales-report';
import type { SalesReport } from '@/server/services/reports.service';
import { formatCount, ReportCard } from './report-card';

/**
 * B12 "Speed & size": how fast buyers pay and how fast payments are
 * verified (medians from the audit trail), how big an order is, and what
 * a ticket really sold for after discounts. Medians, not means: one
 * order that sat for three days must not move the number.
 */
export function SpeedCard({ report }: { report: SalesReport }) {
  const { timings, orderSize, revenue } = report;
  const max = Math.max(1, ...orderSize.histogram);

  return (
    <ReportCard title="Speed & size" subtitle="Medians from the audit trail" testId="speed">
      <dl className="grid grid-cols-2 gap-4">
        <Stat
          label="Time to pay"
          value={timings.toPayMedianS === null ? '—' : formatDuration(timings.toPayMedianS)}
          note={
            timings.toPayN === 0
              ? 'no trxID submitted yet'
              : `median of ${formatCount(timings.toPayN)} ${timings.toPayN === 1 ? 'order' : 'orders'}`
          }
        />
        <Stat
          label="Time to verify"
          value={timings.toVerifyMedianS === null ? '—' : formatDuration(timings.toVerifyMedianS)}
          note={
            timings.toVerifyN === 0
              ? 'nothing approved yet'
              : `median of ${formatCount(timings.toVerifyN)} ${timings.toVerifyN === 1 ? 'approval' : 'approvals'}`
          }
        />
        <Stat
          label="Tickets per order"
          value={orderSize.orders === 0 ? '—' : String(orderSize.average)}
          note={
            orderSize.orders === 0
              ? 'no verified orders yet'
              : `${formatCount(orderSize.tickets)} ${orderSize.tickets === 1 ? 'ticket' : 'tickets'} in ${formatCount(orderSize.orders)} verified ${orderSize.orders === 1 ? 'order' : 'orders'}`
          }
        />
        <Stat
          label="Average ticket price"
          value={orderSize.tickets === 0 ? '—' : formatBDT(revenue.avgTicketPaisa)}
          note={revenue.discountPaisa > 0 ? 'after discounts' : 'as paid'}
        />
      </dl>

      <figure className="flex flex-col gap-1.5">
        <figcaption className="text-[13px] font-medium">Order sizes</figcaption>
        <div
          role="img"
          aria-label={
            orderSize.orders === 0
              ? 'Order sizes: no verified orders yet.'
              : `Verified orders by number of tickets: ${orderSize.histogram
                  .map((n, i) => (n > 0 ? `${i + 1} ticket${i === 0 ? '' : 's'}: ${n}` : null))
                  .filter(Boolean)
                  .join(', ')}.`
          }
          className="flex h-16 items-end gap-1.5"
        >
          {orderSize.histogram.map((n, i) => (
            <div
              key={i}
              className="flex h-full flex-1 flex-col justify-end"
              title={`${n} ${n === 1 ? 'order' : 'orders'} of ${i + 1} ${i === 0 ? 'ticket' : 'tickets'}`}
            >
              <div
                className={
                  n > 0
                    ? 'w-full rounded-t-[3px] bg-foreground'
                    : 'w-full rounded-t-[3px] bg-[#edeae3]'
                }
                style={{ height: n > 0 ? `${Math.max(6, (n / max) * 100)}%` : '3px' }}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-1.5 text-[11px] text-muted-foreground tabular" aria-hidden="true">
          {orderSize.histogram.map((_, i) => (
            <div key={i} className="flex-1 text-center">
              {i + 1}
            </div>
          ))}
        </div>
      </figure>
    </ReportCard>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="font-heading text-2xl leading-none font-semibold tabular">{value}</dd>
      <dd className="text-[12px] text-muted-foreground">{note}</dd>
    </div>
  );
}
