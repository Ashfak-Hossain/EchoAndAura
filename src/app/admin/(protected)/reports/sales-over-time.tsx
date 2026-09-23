import { formatBDT } from '@/server/lib/money';
import type { SalesReport } from '@/server/services/reports.service';
import { dhakaDay } from '@/lib/time';
import { CumulativeChart, DailyBarsChart } from './charts';
import { formatCount, ReportCard } from './report-card';

/**
 * B12 "Sales over time": daily bars (tickets verified per Dhaka day, today
 * in marigold so "is it still selling" is answerable at a glance) and the
 * cumulative line against capacity, with the registration close and the
 * event day marked when they fall inside the window. Plain divs and one
 * inline SVG — no chart dependency. A visually-hidden table carries the
 * same numbers for screen readers.
 */
export function SalesOverTime({ report }: { report: SalesReport }) {
  const { daily, cumulative, window, seats, event } = report;
  const first = daily.points[0];
  const last = daily.points.at(-1);
  const subtitle =
    first && last
      ? `${first.label} – ${last.label} · ${window.days} ${window.days === 1 ? 'day' : 'days'}`
      : undefined;
  const periodTickets = daily.points.reduce((n, p) => n + p.tickets, 0);

  return (
    <ReportCard
      title="Sales over time"
      subtitle={subtitle}
      aside={`${formatCount(periodTickets)} ${periodTickets === 1 ? 'ticket' : 'tickets'} · ${formatBDT(report.period.current.paisa)} in this period`}
      testId="sales-over-time"
    >
      <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-2">
        <DailyBars report={report} />
        <CumulativeLine
          points={cumulative.points}
          capacity={seats.total}
          // Compared like for like: the lines are buyer sales, so are these seats.
          seatsSold={seats.sold - report.complimentary.tickets}
          compSeats={report.complimentary.tickets}
          closesDay={event.registrationClosesAt ? dhakaDay(event.registrationClosesAt) : null}
          eventDay={dhakaDay(event.startsAt)}
        />
      </div>

      <table className="sr-only">
        <caption>Tickets verified per day</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Orders</th>
            <th>Tickets</th>
            <th>Revenue</th>
            <th>Verified to date</th>
          </tr>
        </thead>
        <tbody>
          {daily.points.map((p, i) => (
            <tr key={p.day}>
              <td>{p.label}</td>
              <td>{p.orders}</td>
              <td>{p.tickets}</td>
              <td>{formatBDT(p.paisa)}</td>
              <td>{cumulative.points[i]?.cumulative ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ReportCard>
  );
}

function DailyBars({ report }: { report: SalesReport }) {
  const { points, peak } = report.daily;
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-[13px] font-medium">Daily</figcaption>
      <div
        role="img"
        aria-label={
          peak
            ? `Tickets verified per day. Peak ${peak.label}: ${peak.tickets} tickets.`
            : 'Tickets verified per day: none in this period.'
        }
      >
        <DailyBarsChart points={points} />
      </div>
      <p className="text-[13px] text-muted-foreground">
        {peak
          ? `Peak was ${peak.label} — ${peak.tickets} ${peak.tickets === 1 ? 'ticket' : 'tickets'}, ${formatBDT(peak.paisa)}. Today's bar is marigold and still moving.`
          : 'No verified sales in this period. The bars fill in as payments are approved.'}
      </p>
    </figure>
  );
}

function CumulativeLine({
  points,
  capacity,
  seatsSold,
  compSeats,
  closesDay,
  eventDay,
}: {
  points: SalesReport['cumulative']['points'];
  capacity: number;
  /** Seats sold to buyers now (the counter net of cancellations, minus live comps), quoted when it differs. */
  seatsSold: number;
  /** B13: live complimentary seats — in the counters, never in these lines. */
  compSeats: number;
  closesDay: string | null;
  eventDay: string;
}) {
  const end = points.at(-1)?.cumulative ?? 0;
  const last = points.at(-1);
  const inWindow = (day: string) => points.some((p) => p.day === day);
  const markers = [
    closesDay && inWindow(closesDay) ? { label: 'reg. closes', day: closesDay } : null,
    inWindow(eventDay) ? { label: 'event', day: eventDay } : null,
  ].filter((m): m is { label: string; day: string } => m !== null);

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-[13px] font-medium">Cumulative</figcaption>
      <div
        role="img"
        aria-label={`Tickets verified to date: ${points[0]?.cumulative ?? 0} at the start of the period, ${end} at the end${capacity > 0 ? `, of ${capacity} seats` : ''}.`}
      >
        <CumulativeChart points={points} capacity={capacity} markers={markers} />
      </div>
      <p className="text-[13px] text-muted-foreground">
        {capacity > 0
          ? `${formatCount(end)} ${end === 1 ? 'ticket' : 'tickets'} verified by ${last?.isToday ? 'today' : (last?.label ?? 'now')}${
              end !== seatsSold
                ? ` · ${formatCount(seatsSold)} ${seatsSold === 1 ? 'seat' : 'seats'} sold now, after cancellations`
                : ''
            }.${
              compSeats > 0
                ? ` ${formatCount(compSeats)} complimentary ${compSeats === 1 ? 'seat is' : 'seats are'} not in these lines.`
                : ''
            } The dashed line is capacity (${formatCount(capacity)}).`
          : 'Add ticket types to see the capacity line.'}
      </p>
    </figure>
  );
}
