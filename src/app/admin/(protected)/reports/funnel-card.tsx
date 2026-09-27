import { formatBDT } from '@/server/lib/money';
import type { SalesReport } from '@/server/services/reports.service';
import { percent } from '@/server/lib/sales-report';
import { formatCount, ReportCard } from './report-card';

/**
 * B12 order funnel: how many registrations became money. Three bars in
 * the order the state machine runs, then what fell out and why — each
 * line says what happened to the money in the words B9 uses ("never
 * received", "returned outside"), never "refunded".
 */
export function FunnelCard({ report }: { report: SalesReport }) {
  const f = report.funnel;
  const steps = [
    { label: 'Orders placed', count: f.placed, note: 'every registration' },
    { label: 'Payment submitted', count: f.submitted, note: 'a trxID was entered' },
    { label: 'Verified', count: f.verified, note: `${f.conversionPct}% of placed` },
  ];

  return (
    <ReportCard
      title="Order funnel"
      subtitle="From registration to verified payment"
      testId="funnel"
    >
      <ol className="flex flex-col gap-3">
        {steps.map((s, i) => {
          const width =
            f.placed > 0 ? Math.max(percent(s.count, f.placed), s.count > 0 ? 2 : 0) : 0;
          return (
            <li key={s.label} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="font-medium">{s.label}</span>
                <span className="text-muted-foreground tabular">
                  <span className="font-heading text-lg font-semibold text-foreground">
                    {formatCount(s.count)}
                  </span>{' '}
                  · {s.note}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-[5px] bg-[#edeae3]">
                <div
                  className={i === 2 ? 'h-full bg-success' : 'h-full bg-foreground'}
                  style={{ width: `${width}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>

      <dl className="flex flex-col gap-1.5 text-[13px]">
        <Line
          label="Waiting on the buyer"
          value={`${formatCount(f.pendingPayment.count)} · ${formatBDT(f.pendingPayment.paisa)}`}
          note="held for 24 h"
        />
        <Line
          label="Waiting on you"
          value={`${formatCount(f.pendingVerification.count)} · ${formatBDT(f.pendingVerification.paisa)}`}
          note="in the verification queue"
        />
        <Line
          label="Rejected"
          value={`${formatCount(f.rejected.count)} · ${formatBDT(f.rejected.paisa)}`}
          note="never received"
        />
        <Line
          label="Expired"
          value={`${formatCount(f.expired.count)} · ${formatBDT(f.expired.paisa)}`}
          note="hold lapsed, never received"
        />
        <Line
          label="Cancelled orders"
          value={`${formatCount(f.cancelled.count)} · ${formatBDT(f.cancelled.paisa)}`}
          note="returned outside the app"
        />
        <Line
          label="Cancelled tickets"
          value={formatCount(report.cancelledTickets)}
          note={report.cancelledTickets === 1 ? 'seat back on sale' : 'seats back on sale'}
        />
      </dl>
    </ReportCard>
  );
}

function Line({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-border py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular">
        <span className="font-medium">{value}</span>{' '}
        <span className="text-[12px] text-muted-foreground">{note}</span>
      </dd>
    </div>
  );
}
