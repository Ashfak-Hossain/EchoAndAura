import { describe, expect, it } from 'vitest';
import type { EventRecord } from '@/server/repositories/events.repository';
import {
  cumulativeSeries,
  dailySeries,
  daysBetween,
  defaultReportEvent,
  delta,
  dhakaDaysUntil,
  formatDuration,
  funnel,
  inDays,
  histograms,
  orderSizeStats,
  percent,
  periodTotals,
  rangeWindow,
  shiftDay,
  type DailySalesRow,
} from '@/server/lib/sales-report';
import { averagePaisa } from '@/server/lib/money';
import { dhakaDay } from '@/lib/time';
import { reportsQuerySchema } from '@/lib/validation/reports';

const rows: DailySalesRow[] = [
  { day: '2026-09-01', orders: 1, tickets: 1, paisa: 120_000 },
  { day: '2026-09-10', orders: 2, tickets: 5, paisa: 600_000 },
  { day: '2026-09-16', orders: 3, tickets: 8, paisa: 960_000 },
  { day: '2026-09-18', orders: 1, tickets: 8, paisa: 960_000 },
  { day: '2026-09-21', orders: 1, tickets: 2, paisa: 240_000 },
];

describe('days', () => {
  it('dhakaDay: 18:30Z is already tomorrow in Dhaka', () => {
    expect(dhakaDay(new Date('2026-09-15T17:59:00Z'))).toBe('2026-09-15');
    expect(dhakaDay(new Date('2026-09-15T18:01:00Z'))).toBe('2026-09-16');
  });

  it('shiftDay and daysBetween work on the string form across month ends', () => {
    expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-09-08', '2026-09-21')).toBe(14);
    expect(daysBetween('2026-09-21', '2026-09-21')).toBe(1);
  });

  it('rangeWindow: N days ending today; "all" from the earliest day (never after today)', () => {
    expect(rangeWindow('14', '2026-09-21', null)).toEqual({
      from: '2026-09-08',
      to: '2026-09-21',
      days: 14,
      range: '14',
      today: '2026-09-21',
    });
    // A clamped window (finished event) remembers the real today.
    expect(rangeWindow('14', '2026-09-10', null, '2026-09-21')).toMatchObject({
      to: '2026-09-10',
      today: '2026-09-21',
    });
    expect(rangeWindow('all', '2026-09-21', '2026-09-01')).toMatchObject({
      from: '2026-09-01',
      days: 21,
    });
    expect(rangeWindow('all', '2026-09-21', null)).toMatchObject({ from: '2026-09-21', days: 1 });
    expect(rangeWindow('all', '2026-09-21', '2026-10-01')).toMatchObject({ from: '2026-09-21' });
  });
});

describe('dailySeries', () => {
  const window = rangeWindow('14', '2026-09-21', null);

  it('fills every day of the window with zeros, marks today, ignores rows outside', () => {
    const s = dailySeries(rows, window);
    expect(s.points).toHaveLength(14);
    expect(s.points[0]).toMatchObject({ day: '2026-09-08', tickets: 0, label: 'Tue 8 Sep' });
    expect(s.points.at(-1)).toMatchObject({ day: '2026-09-21', tickets: 2, isToday: true });
    expect(s.points.filter((p) => p.isToday)).toHaveLength(1);
    // No bar is "today" when the window ends before today.
    expect(
      dailySeries(rows, rangeWindow('14', '2026-09-10', null, '2026-09-21')).points.some(
        (p) => p.isToday,
      ),
    ).toBe(false);
    expect(s.points.reduce((n, p) => n + p.tickets, 0)).toBe(23); // 1 Sep is outside
  });

  it('peak is the highest day, earliest on a tie; null when nothing sold', () => {
    const s = dailySeries(rows, window);
    expect(s.peak?.day).toBe('2026-09-16');
    expect(s.maxTickets).toBe(8);
    expect(dailySeries([], window).peak).toBeNull();
    expect(dailySeries([], window).maxTickets).toBe(0);
  });
});

describe('cumulativeSeries', () => {
  it('starts from everything sold before the window and runs to the end', () => {
    const s = cumulativeSeries(rows, rangeWindow('14', '2026-09-21', null));
    expect(s.before).toBe(1);
    expect(s.points[0]?.cumulative).toBe(1);
    expect(s.points.find((p) => p.day === '2026-09-10')?.cumulative).toBe(6);
    expect(s.points.find((p) => p.day === '2026-09-11')?.cumulative).toBe(6);
    expect(s.end).toBe(24);
  });
});

describe('periods', () => {
  it('periodTotals sums inclusively; delta reports change and percent (null with no prior)', () => {
    expect(periodTotals(rows, '2026-09-10', '2026-09-16')).toEqual({
      orders: 5,
      tickets: 13,
      paisa: 1_560_000,
    });
    expect(delta(13, 10)).toEqual({ current: 13, prior: 10, change: 3, pct: 30 });
    expect(delta(5, 10)).toMatchObject({ change: -5, pct: -50 });
    expect(delta(7, 0)).toMatchObject({ change: 7, pct: null });
    expect(delta(0, 0)).toMatchObject({ change: 0, pct: null });
  });

  it('percent and averagePaisa are 0-safe', () => {
    expect(percent(410, 550)).toBe(75);
    expect(percent(0, 0)).toBe(0);
    expect(percent(1, 3)).toBe(33);
    expect(averagePaisa(1_000_001, 3)).toBe(333_334);
    expect(averagePaisa(0, 0)).toBe(0);
    expect(() => averagePaisa(100, -1)).toThrow(RangeError);
    expect(() => averagePaisa(100.5, 1)).toThrow(RangeError);
  });
});

describe('funnel', () => {
  it('counts placed, submitted and verified; cancelled is its own line, never verified', () => {
    const f = funnel([
      { status: 'pending_payment', count: 5, totalPaisa: 600_000, compCount: 0 },
      { status: 'pending_verification', count: 9, totalPaisa: 1_080_000, compCount: 0 },
      { status: 'paid', count: 1, totalPaisa: 120_000, compCount: 0 },
      { status: 'issued', count: 213, totalPaisa: 51_740_000, compCount: 0 },
      { status: 'rejected', count: 4, totalPaisa: 480_000, compCount: 0 },
      { status: 'expired', count: 20, totalPaisa: 2_400_000, compCount: 0 },
      { status: 'cancelled', count: 2, totalPaisa: 240_000, compCount: 0 },
    ]);
    expect(f.placed).toBe(254);
    expect(f.submitted).toBe(9 + 214 + 4 + 2);
    expect(f.verified).toBe(214);
    expect(f.verifiedMoney).toEqual({ count: 214, paisa: 51_860_000 });
    expect(f.conversionPct).toBe(84);
    expect(f.cancelled).toEqual({ count: 2, paisa: 240_000 });
    expect(f.expired).toEqual({ count: 20, paisa: 2_400_000 });
  });

  it('is all zeros with no orders (conversion 0, not NaN)', () => {
    const f = funnel([]);
    expect(f).toMatchObject({ placed: 0, submitted: 0, verified: 0, conversionPct: 0 });
    expect(f.pendingPayment).toEqual({ count: 0, paisa: 0 });
  });
});

describe('histograms', () => {
  it('buckets by hour and weekday and names the peaks; empty → null', () => {
    const h = histograms([
      { dow: 2, hour: 21, n: 4 },
      { dow: 4, hour: 21, n: 3 },
      { dow: 4, hour: 10, n: 2 },
      { dow: 9, hour: 30, n: 99 }, // out of range: ignored, never crashes
    ]);
    expect(h.byHour[21]).toBe(7);
    expect(h.byHour[10]).toBe(2);
    expect(h.byWeekday[4]).toBe(5);
    expect(h.peakHour).toBe(21);
    expect(h.peakWeekday).toBe(4);
    expect(h.total).toBe(9);
    const empty = histograms([]);
    expect(empty.peakHour).toBeNull();
    expect(empty.byHour).toHaveLength(24);
    expect(empty.byWeekday).toHaveLength(7);
  });
});

describe('orderSizeStats', () => {
  it('histogram 1–10, tickets and a one-decimal average; 0 with no orders', () => {
    const s = orderSizeStats([
      { quantity: 1, n: 10 },
      { quantity: 2, n: 5 },
      { quantity: 4, n: 1 },
      { quantity: 11, n: 7 }, // impossible (max 10) — ignored
    ]);
    expect(s.histogram[0]).toBe(10);
    expect(s.histogram[3]).toBe(1);
    expect(s.orders).toBe(16);
    expect(s.tickets).toBe(24);
    expect(s.average).toBe(1.5);
    expect(orderSizeStats([]).average).toBe(0);
  });
});

describe('inDays / dhakaDaysUntil', () => {
  it('never says "in 1 days" and counts Dhaka calendar days', () => {
    expect(inDays(0)).toBe('today');
    expect(inDays(1)).toBe('tomorrow');
    expect(inDays(9)).toBe('in 9 days');
    // 21 Sep 12:00 Dhaka → closes 22 Sep 00:30 Dhaka (21 Sep 18:30Z): tomorrow, not "0 days".
    const now = new Date('2026-09-21T06:00:00Z');
    expect(dhakaDaysUntil(new Date('2026-09-21T18:30:00Z'), now)).toBe(1);
    expect(dhakaDaysUntil(new Date('2026-09-21T15:00:00Z'), now)).toBe(0);
    expect(dhakaDaysUntil(new Date('2026-09-30T15:00:00Z'), now)).toBe(9);
  });
});

describe('formatDuration', () => {
  it('reads like a person would say it', () => {
    expect(formatDuration(45)).toBe('under a minute');
    expect(formatDuration(1_800)).toBe('30 min');
    expect(formatDuration(5_400)).toBe('1h 30m');
    expect(formatDuration(7_200)).toBe('2h');
    expect(formatDuration(86_400 * 3)).toBe('3 days');
    expect(formatDuration(86_400)).toBe('1 day');
    expect(formatDuration(-5)).toBe('under a minute');
  });
});

describe('defaultReportEvent', () => {
  const ev = (over: Partial<EventRecord>): EventRecord =>
    ({
      id: over.id ?? 'x',
      slug: 'x',
      title: 'x',
      description: null,
      venue: null,
      startsAt: new Date('2026-10-01T13:00:00Z'),
      endsAt: null,
      registrationOpensAt: null,
      registrationClosesAt: null,
      status: 'published',
      imageKey: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    }) as EventRecord;
  const now = new Date('2026-09-21T06:00:00Z');

  it('prefers the soonest upcoming published event over drafts and later ones', () => {
    const later = ev({ id: 'later', startsAt: new Date('2026-12-01T13:00:00Z') });
    const soon = ev({ id: 'soon', startsAt: new Date('2026-10-01T13:00:00Z') });
    const draft = ev({ id: 'draft', status: 'draft', startsAt: new Date('2026-09-25T13:00:00Z') });
    const past = ev({ id: 'past', startsAt: new Date('2026-09-01T13:00:00Z') });
    expect(defaultReportEvent([later, draft, past, soon], now)?.id).toBe('soon');
  });

  it('falls back to the most recent event of any status; null with none', () => {
    const past = ev({ id: 'past', status: 'archived', startsAt: new Date('2026-09-01T13:00:00Z') });
    const older = ev({
      id: 'older',
      status: 'archived',
      startsAt: new Date('2026-06-01T13:00:00Z'),
    });
    expect(defaultReportEvent([older, past], now)?.id).toBe('past');
    expect(defaultReportEvent([], now)).toBeNull();
  });
});

describe('reportsQuerySchema', () => {
  it('drops an invalid event id and falls back on unknown range/section, never a 400', () => {
    expect(reportsQuerySchema.parse({})).toEqual({
      event: undefined,
      range: undefined,
      section: 'summary',
    });
    expect(reportsQuerySchema.parse({ event: 'nope', range: '7', section: 'x' })).toEqual({
      event: undefined,
      range: undefined,
      section: 'summary',
    });
    const id = '5f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
    expect(reportsQuerySchema.parse({ event: id, range: 'all', section: 'daily' })).toEqual({
      event: id,
      range: 'all',
      section: 'daily',
    });
  });
});
