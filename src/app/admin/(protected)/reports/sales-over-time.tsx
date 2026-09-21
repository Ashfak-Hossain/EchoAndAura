import { formatBDT } from '@/server/lib/money';
import type { SalesReport } from '@/server/services/reports.service';
import { dhakaDay } from '@/lib/time';
import { cn } from '@/lib/utils';
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
          seatsSold={seats.sold}
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
  const { daily } = report;
  const { points, peak, maxTickets } = daily;
  const n = points.length;
  // Dense windows ("All time") get thinner bars and scroll inside the card.
  const minWidth = n > 45 ? `${n * 9}px` : undefined;
  const labelEvery = n <= 14 ? 1 : n <= 31 ? 7 : n <= 92 ? 14 : 30;

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-[13px] font-medium">Daily</figcaption>
      <div className="overflow-x-auto">
        <div
          role="img"
          aria-label={
            peak
              ? `Tickets verified per day. Peak ${peak.label}: ${peak.tickets} tickets.`
              : 'Tickets verified per day: none in this period.'
          }
          className="flex h-40 items-end gap-0.75 border-b border-border"
          style={{ minWidth }}
        >
          {points.map((p) => (
            <div
              key={p.day}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`${p.label} · ${p.tickets} ${p.tickets === 1 ? 'ticket' : 'tickets'} · ${formatBDT(p.paisa)}`}
              data-testid={p.isToday ? 'bar-today' : undefined}
              data-tickets={p.tickets}
            >
              <div
                className={cn(
                  'w-full rounded-t-[3px]',
                  p.isToday ? 'bg-marigold' : 'bg-foreground',
                  p.tickets === 0 && 'opacity-25',
                )}
                style={{
                  height:
                    p.tickets === 0 ? '2px' : `${Math.max(3, (p.tickets / maxTickets) * 100)}%`,
                }}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-0.75" style={{ minWidth }} aria-hidden="true">
          {points.map((p, i) => {
            // Ends always labelled; interior ticks keep clear of both ends so labels never overlap.
            const clear = i >= labelEvery / 2 && n - 1 - i >= labelEvery / 2;
            const show = i === 0 || i === n - 1 || (i % labelEvery === 0 && clear);
            return (
              <div
                key={p.day}
                className="min-w-0 flex-1 pt-1 text-[11px] whitespace-nowrap text-muted-foreground tabular"
              >
                {show ? (p.isToday ? 'today' : p.label.slice(4)) : ''}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-[13px] text-muted-foreground">
        {peak
          ? `Peak was ${peak.label} — ${peak.tickets} ${peak.tickets === 1 ? 'ticket' : 'tickets'}, ${formatBDT(peak.paisa)}. Today's bar is marigold and still moving.`
          : 'No verified sales in this period. The bars fill in as payments are approved.'}
      </p>
    </figure>
  );
}

const W = 600;
const H = 180;
const PAD = { top: 12, right: 8, bottom: 22, left: 36 };

function CumulativeLine({
  points,
  capacity,
  seatsSold,
  closesDay,
  eventDay,
}: {
  points: SalesReport['cumulative']['points'];
  capacity: number;
  /** The inventory counter (net of cancellations) — the KPI's number, quoted when it differs. */
  seatsSold: number;
  closesDay: string | null;
  eventDay: string;
}) {
  const n = points.length;
  const end = points.at(-1)?.cumulative ?? 0;
  const yMax = Math.max(capacity, end, 1);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;

  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.cumulative).toFixed(1)}`).join(' ');
  const area = `M${x(0).toFixed(1)},${y(0).toFixed(1)} L${line.replaceAll(' ', ' L')} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} Z`;
  const capY = y(capacity);
  const index = (day: string) => points.findIndex((p) => p.day === day);
  const markers = [
    closesDay ? { day: closesDay, label: 'reg. closes' } : null,
    { day: eventDay, label: 'event' },
  ]
    .filter((m): m is { day: string; label: string } => m !== null)
    .map((m) => ({ ...m, i: index(m.day) }))
    .filter((m) => m.i >= 0);
  const first = points[0];
  const last = points.at(-1);

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-[13px] font-medium">Cumulative</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Tickets verified to date: ${points[0]?.cumulative ?? 0} at the start of the period, ${end} at the end${capacity > 0 ? `, of ${capacity} seats` : ''}.`}
        className="h-auto w-full"
      >
        {capacity > 0 ? (
          <>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={capY}
              y2={capY}
              stroke="#a8a29a"
              strokeDasharray="4 4"
            />
            <text x={PAD.left - 6} y={capY + 4} textAnchor="end" fontSize="11" fill="#5c574c">
              {formatCount(capacity)}
            </text>
          </>
        ) : null}
        <text x={PAD.left - 6} y={y(0) + 4} textAnchor="end" fontSize="11" fill="#5c574c">
          0
        </text>
        {n > 0 ? (
          <>
            <path d={area} fill="#1c1a17" fillOpacity="0.08" />
            <polyline
              points={line}
              fill="none"
              stroke="#1c1a17"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {last ? (
              <>
                <circle cx={x(n - 1)} cy={y(end)} r="4" fill="#eda43c" stroke="#1c1a17" />
                <text
                  x={Math.min(x(n - 1), W - PAD.right - 30)}
                  y={y(end) - 8}
                  textAnchor="end"
                  fontSize="12"
                  fontWeight="600"
                  fill="#1c1a17"
                >
                  {formatCount(end)}
                </text>
              </>
            ) : null}
          </>
        ) : null}
        {markers.map((m) => (
          <g key={m.label}>
            <line
              x1={x(m.i)}
              x2={x(m.i)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="#eda43c"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
            <text
              x={x(m.i) + 4}
              y={PAD.top + 10}
              fontSize="10"
              fill="#8a5209"
              textAnchor={m.i > n / 2 ? 'end' : 'start'}
              dx={m.i > n / 2 ? -8 : 0}
            >
              {m.label}
            </text>
          </g>
        ))}
        {first ? (
          <text x={PAD.left} y={H - 6} fontSize="11" fill="#5c574c">
            {first.label}
          </text>
        ) : null}
        {last ? (
          <text x={W - PAD.right} y={H - 6} fontSize="11" fill="#5c574c" textAnchor="end">
            {last.isToday ? 'today' : last.label}
          </text>
        ) : null}
      </svg>
      <p className="text-[13px] text-muted-foreground">
        {capacity > 0
          ? `${formatCount(end)} ${end === 1 ? 'ticket' : 'tickets'} verified by ${last?.isToday ? 'today' : (last?.label ?? 'now')}${
              end !== seatsSold
                ? ` · ${formatCount(seatsSold)} ${seatsSold === 1 ? 'seat' : 'seats'} sold now, after cancellations`
                : ''
            }. The dashed line is capacity (${formatCount(capacity)}).`
          : 'Add ticket types to see the capacity line.'}
      </p>
    </figure>
  );
}
