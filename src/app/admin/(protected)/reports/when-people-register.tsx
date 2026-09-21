import { WEEKDAY_LABELS } from '@/server/lib/sales-report';
import type { SalesReport } from '@/server/services/reports.service';
import { cn } from '@/lib/utils';
import { formatCount, ReportCard } from './report-card';

/**
 * B12 "When people register": every order placed (any status — this is
 * when buyers act, not when money lands) by Dhaka hour and weekday. The
 * practical use is timing a Facebook post; the peak bucket is marigold.
 */
export function WhenPeopleRegister({ report }: { report: SalesReport }) {
  const h = report.whenPeopleRegister;
  const hourCaption =
    h.peakHour === null
      ? 'No registrations yet.'
      : `Most registrations come in between ${pad(h.peakHour)}:00 and ${pad((h.peakHour + 1) % 24)}:00 Dhaka time`;
  const dayCaption =
    h.peakWeekday === null
      ? ''
      : `${h.peakHour === null ? '' : '— and '}${WEEKDAY_LABELS[h.peakWeekday]} is the busiest day.`;

  return (
    <ReportCard
      title="When people register"
      subtitle={`${formatCount(h.total)} ${h.total === 1 ? 'order' : 'orders'} placed, all statuses · Dhaka time`}
      testId="when-people-register"
    >
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr] print:grid-cols-[3fr_2fr]">
        <Histogram
          title="By hour of day"
          values={h.byHour}
          peak={h.peakHour}
          label={(i) => `${pad(i)}:00`}
          tick={(i) => (i % 6 === 0 || i === 23 ? `${pad(i)}` : '')}
          minWidth="360px"
        />
        <Histogram
          title="By weekday"
          values={h.byWeekday}
          peak={h.peakWeekday}
          label={(i) => WEEKDAY_LABELS[i] ?? ''}
          tick={(i) => WEEKDAY_LABELS[i] ?? ''}
        />
      </div>
      <p className="text-[13px] text-muted-foreground">
        {hourCaption} {dayCaption}
      </p>
    </ReportCard>
  );
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function Histogram({
  title,
  values,
  peak,
  label,
  tick,
  minWidth,
}: {
  title: string;
  values: number[];
  peak: number | null;
  label: (i: number) => string;
  tick: (i: number) => string;
  /** Twenty-four bars need room for their labels: scroll inside the card on phones. */
  minWidth?: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <figcaption className="text-[13px] font-medium">{title}</figcaption>
      <div className="overflow-x-auto">
        <div
          role="img"
          aria-label={
            peak === null
              ? `${title}: no registrations yet.`
              : `${title}: busiest ${label(peak)} with ${values[peak]} ${values[peak] === 1 ? 'order' : 'orders'}.`
          }
          className="flex h-24 items-end gap-[3px] border-b border-border"
          style={{ minWidth }}
        >
          {values.map((v, i) => (
            <div
              key={i}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`${label(i)} · ${v} ${v === 1 ? 'order' : 'orders'}`}
            >
              <div
                className={cn(
                  'w-full rounded-t-[2px]',
                  i === peak ? 'bg-marigold' : 'bg-foreground',
                  v === 0 && 'opacity-25',
                )}
                style={{ height: v === 0 ? '2px' : `${Math.max(4, (v / max) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <div
          className="flex gap-[3px] text-[11px] text-muted-foreground tabular"
          style={{ minWidth }}
          aria-hidden="true"
        >
          {values.map((_, i) => (
            <div key={i} className="min-w-0 flex-1 truncate text-center">
              {tick(i)}
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}
