import { WEEKDAY_LABELS } from '@/server/lib/sales-report';
import type { SalesReport } from '@/server/services/reports.service';
import { HistogramChart, type HistogramDatum } from './charts';
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
          peak={h.peakHour}
          data={h.byHour.map((v, i) => ({
            key: String(i),
            tick: i % 6 === 0 || i === 23 ? pad(i) : '',
            label: `${pad(i)}:00 – ${pad((i + 1) % 24)}:00 Dhaka`,
            value: v,
            peak: i === h.peakHour,
          }))}
        />
        <Histogram
          title="By weekday"
          peak={h.peakWeekday}
          data={h.byWeekday.map((v, i) => ({
            key: String(i),
            tick: WEEKDAY_LABELS[i] ?? '',
            label: WEEKDAY_LABELS[i] ?? '',
            value: v,
            peak: i === h.peakWeekday,
          }))}
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
  data,
  peak,
}: {
  title: string;
  data: HistogramDatum[];
  peak: number | null;
}) {
  const top = peak === null ? null : data[peak];
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <figcaption className="text-[13px] font-medium">{title}</figcaption>
      <div
        role="img"
        aria-label={
          top
            ? `${title}: busiest ${top.label} with ${top.value} ${top.value === 1 ? 'order' : 'orders'}.`
            : `${title}: no registrations yet.`
        }
      >
        <HistogramChart data={data} unit={['order', 'orders']} />
      </div>
    </figure>
  );
}
