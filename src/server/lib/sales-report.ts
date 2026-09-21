import { formatInTimeZone } from 'date-fns-tz';
import type { EventRecord } from '@/server/repositories/events.repository';
import type { StatusTotal } from '@/server/repositories/orders.repository';
import { REVENUE_STATUSES } from '@/server/lib/order-status';
import { type ReportRange } from '@/lib/report-range';
import { dhakaDay } from '@/lib/time';

/**
 * B12 sales report — the pure half. Everything here is arithmetic over
 * rows the repository already aggregated, so it runs in unit tests with
 * no database. Money stays integer paisa (Invariant 1); the page formats.
 *
 * Days are Dhaka calendar days as `yyyy-MM-dd` strings: the repository
 * groups by that in SQL, and strings compare and sort lexicographically,
 * so no offset arithmetic ever happens here.
 */

export { type ReportRange };

/** One Dhaka day of verified sales, as the repository returns it. */
export interface DailySalesRow {
  day: string;
  orders: number;
  tickets: number;
  paisa: number;
}

/** The report's period: `from`..`to` inclusive, Dhaka days. */
export interface ReportWindow {
  from: string;
  to: string;
  days: number;
  range: ReportRange;
  /** The real today, so a clamped window (finished event) never paints a "today" bar. */
  today: string;
}

export interface DailyPoint extends DailySalesRow {
  /** "Wed 16 Sep" */
  label: string;
  isToday: boolean;
}

export interface DailySeries {
  points: DailyPoint[];
  /** The day with the most tickets (earliest on a tie); null when nothing sold. */
  peak: DailyPoint | null;
  maxTickets: number;
}

export interface CumulativePoint {
  day: string;
  label: string;
  /** Tickets verified up to and including this day (all time, not just the window; gross of cancellations). */
  cumulative: number;
  isToday: boolean;
}

export interface CumulativeSeries {
  points: CumulativePoint[];
  /** Verified before the window opened — where the line starts. */
  before: number;
  /** Verified by the end of the window. */
  end: number;
}

export interface PeriodTotals {
  orders: number;
  tickets: number;
  paisa: number;
}

export interface Delta {
  current: number;
  prior: number;
  change: number;
  /** Percent change against `prior`; null when there was nothing before. */
  pct: number | null;
}

/** `day` ± n days, on the string form (UTC arithmetic on a date-only value is exact). */
export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` inclusive (1 when equal). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

/** "Wed 16 Sep" for a `yyyy-MM-dd` day. */
export function dayLabel(day: string): string {
  return formatInTimeZone(new Date(`${day}T00:00:00Z`), 'UTC', 'EEE d MMM');
}

/**
 * The window a range means, ending on `to` (today, or for a finished
 * event the later of its day and its last sale — hundreds of empty
 * trailing bars say nothing). "all" runs from the earliest day that
 * matters (first sale or registration opening, whichever is first — the
 * caller passes it) so the chart shows the whole campaign.
 */
export function rangeWindow(
  range: ReportRange,
  to: string,
  earliest: string | null,
  today: string = to,
): ReportWindow {
  if (range === 'all') {
    const from = earliest && earliest < to ? earliest : to;
    return { from, to, days: daysBetween(from, to), range, today };
  }
  const days = Number(range);
  return { from: shiftDay(to, -(days - 1)), to, days, range, today };
}

/** "today" / "tomorrow" / "in 9 days" for a Dhaka day count (never "in 1 days"). */
export function inDays(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** Whole Dhaka days from now until `date` (0 = later today; negative = past). */
export function dhakaDaysUntil(date: Date, now: Date): number {
  return daysBetween(dhakaDay(now), dhakaDay(date)) - 1;
}

/** Zero-filled day series across the window; rows outside it are ignored. */
export function dailySeries(rows: readonly DailySalesRow[], window: ReportWindow): DailySeries {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const points: DailyPoint[] = [];
  for (let day = window.from; day <= window.to; day = shiftDay(day, 1)) {
    const r = byDay.get(day);
    points.push({
      day,
      label: dayLabel(day),
      orders: r?.orders ?? 0,
      tickets: r?.tickets ?? 0,
      paisa: r?.paisa ?? 0,
      isToday: day === window.today,
    });
  }
  let peak: DailyPoint | null = null;
  for (const p of points) {
    if (p.tickets > 0 && (peak === null || p.tickets > peak.tickets)) peak = p;
  }
  return { points, peak, maxTickets: peak?.tickets ?? 0 };
}

/** Running total of tickets sold, starting from everything sold before the window. */
export function cumulativeSeries(
  rows: readonly DailySalesRow[],
  window: ReportWindow,
): CumulativeSeries {
  let before = 0;
  const byDay = new Map<string, number>();
  for (const r of rows) {
    if (r.day < window.from) before += r.tickets;
    else if (r.day <= window.to) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.tickets);
  }
  const points: CumulativePoint[] = [];
  let running = before;
  for (let day = window.from; day <= window.to; day = shiftDay(day, 1)) {
    running += byDay.get(day) ?? 0;
    points.push({ day, label: dayLabel(day), cumulative: running, isToday: day === window.today });
  }
  return { points, before, end: running };
}

/** Sum of the rows inside `from`..`to` inclusive. */
export function periodTotals(
  rows: readonly DailySalesRow[],
  from: string,
  to: string,
): PeriodTotals {
  const t: PeriodTotals = { orders: 0, tickets: 0, paisa: 0 };
  for (const r of rows) {
    if (r.day < from || r.day > to) continue;
    t.orders += r.orders;
    t.tickets += r.tickets;
    t.paisa += r.paisa;
  }
  return t;
}

/** Change against the prior period; `pct` is null when the prior was zero ("new"). */
export function delta(current: number, prior: number): Delta {
  return {
    current,
    prior,
    change: current - prior,
    pct: prior === 0 ? null : Math.round(((current - prior) / prior) * 100),
  };
}

/** Integer percent, 0 when the denominator is 0 (a "0 of 0" event is not 100% sold). */
export function percent(n: number, of: number): number {
  return of > 0 ? Math.round((n / of) * 100) : 0;
}

/**
 * The order funnel, from the per-status totals of one event. "Submitted"
 * means the order reached the verification queue at some point: still
 * waiting, verified, rejected — or cancelled later, which is
 * post-verification. Verified = the revenue statuses only; a cancelled
 * order's money left (ADR-024), so it is its own line, never "verified".
 */
export interface Funnel {
  placed: number;
  submitted: number;
  verified: number;
  /** verified / placed */
  conversionPct: number;
  pendingPayment: PeriodMoney;
  pendingVerification: PeriodMoney;
  verifiedMoney: PeriodMoney;
  rejected: PeriodMoney;
  expired: PeriodMoney;
  cancelled: PeriodMoney;
}

export interface PeriodMoney {
  count: number;
  paisa: number;
}

export function funnel(byStatus: readonly StatusTotal[]): Funnel {
  const zero = (): PeriodMoney => ({ count: 0, paisa: 0 });
  const pick = (status: StatusTotal['status']): PeriodMoney => {
    const t = byStatus.find((s) => s.status === status);
    return t ? { count: t.count, paisa: t.totalPaisa } : zero();
  };
  const add = (a: PeriodMoney, b: PeriodMoney): PeriodMoney => ({
    count: a.count + b.count,
    paisa: a.paisa + b.paisa,
  });
  const pendingPayment = pick('pending_payment');
  const pendingVerification = pick('pending_verification');
  const verifiedMoney = REVENUE_STATUSES.map(pick).reduce(add, zero());
  const rejected = pick('rejected');
  const expired = pick('expired');
  const cancelled = pick('cancelled');
  const placed = byStatus.reduce((n, t) => n + t.count, 0);
  const submitted =
    pendingVerification.count + verifiedMoney.count + rejected.count + cancelled.count;
  return {
    placed,
    submitted,
    verified: verifiedMoney.count,
    conversionPct: percent(verifiedMoney.count, placed),
    pendingPayment,
    pendingVerification,
    verifiedMoney,
    rejected,
    expired,
    cancelled,
  };
}

/** Orders placed per Dhaka weekday (0 = Sunday, as Postgres counts) and hour. */
export interface WeekdayHourRow {
  dow: number;
  hour: number;
  n: number;
}

export interface Histograms {
  byHour: number[];
  byWeekday: number[];
  peakHour: number | null;
  peakWeekday: number | null;
  total: number;
}

export function histograms(rows: readonly WeekdayHourRow[]): Histograms {
  const byHour = Array.from({ length: 24 }, () => 0);
  const byWeekday = Array.from({ length: 7 }, () => 0);
  let total = 0;
  for (const r of rows) {
    if (r.hour < 0 || r.hour > 23 || r.dow < 0 || r.dow > 6) continue;
    byHour[r.hour] = (byHour[r.hour] ?? 0) + r.n;
    byWeekday[r.dow] = (byWeekday[r.dow] ?? 0) + r.n;
    total += r.n;
  }
  const peak = (xs: number[]): number | null => {
    let best: number | null = null;
    xs.forEach((v, i) => {
      if (v > 0 && (best === null || v > (xs[best] ?? 0))) best = i;
    });
    return best;
  };
  return { byHour, byWeekday, peakHour: peak(byHour), peakWeekday: peak(byWeekday), total };
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Verified orders by size (1–10 tickets, the business rule's cap). */
export interface OrderSizeRow {
  quantity: number;
  n: number;
}

export interface OrderSizeStats {
  /** Index 0 = one-ticket orders … index 9 = ten. */
  histogram: number[];
  orders: number;
  tickets: number;
  /** Tickets per order to one decimal; 0 with no orders. */
  average: number;
}

export function orderSizeStats(rows: readonly OrderSizeRow[]): OrderSizeStats {
  const histogram = Array.from({ length: 10 }, () => 0);
  let orders = 0;
  let tickets = 0;
  for (const r of rows) {
    if (r.quantity < 1 || r.quantity > 10) continue;
    histogram[r.quantity - 1] = (histogram[r.quantity - 1] ?? 0) + r.n;
    orders += r.n;
    tickets += r.n * r.quantity;
  }
  return {
    histogram,
    orders,
    tickets,
    average: orders > 0 ? Math.round((tickets / orders) * 10) / 10 : 0,
  };
}

/** "under a minute", "45 min", "2h 10m", "3 days" — for the median timings. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return 'under a minute';
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  const rest = min % 60;
  if (hours < 24) return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * Which event the report opens on when the URL names none: the published
 * event starting soonest that has not started yet (the one being sold
 * right now), else the most recent event of any status.
 */
export function defaultReportEvent(events: readonly EventRecord[], now: Date): EventRecord | null {
  const upcoming = events
    .filter((e) => e.status === 'published' && e.startsAt.getTime() > now.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  if (upcoming) return upcoming;
  return [...events].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0] ?? null;
}
