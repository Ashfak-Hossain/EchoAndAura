import { describe, expect, it, vi } from 'vitest';
import type { DayTotals } from '@/server/repositories/reports.repository';
import {
  EXPIRING_WITHIN_HOURS,
  RECENT_ORDERS,
  createDashboardService,
  dhakaDayStart,
  quietDay,
  vsYesterday,
  type DashboardDeps,
  type DashboardSummary,
} from '@/server/services/dashboard.service';

/**
 * B3 with fakes: the day is Dhaka's (UTC+6, no DST), each figure asks the
 * repository for the right window, and the pure rules read as designed.
 */
const NOW = new Date('2026-09-24T18:10:00Z'); // Fri 25 Sep 00:10 Dhaka — just after midnight
const zero: DayTotals = { ordersPlaced: 0, approvedOrders: 0, approvedPaisa: 0 };

describe('dhakaDayStart', () => {
  it('is Dhaka midnight in UTC, whatever the UTC date says', () => {
    expect(dhakaDayStart(NOW).toISOString()).toBe('2026-09-24T18:00:00.000Z'); // 25 Sep 00:00 Dhaka
    expect(dhakaDayStart(NOW, -1).toISOString()).toBe('2026-09-23T18:00:00.000Z');
    expect(dhakaDayStart(NOW, 1).toISOString()).toBe('2026-09-25T18:00:00.000Z');
    // 23:30 Dhaka the day before belongs to yesterday.
    expect(dhakaDayStart(new Date('2026-09-24T17:30:00Z')).toISOString()).toBe(
      '2026-09-23T18:00:00.000Z',
    );
  });
});

describe('vsYesterday', () => {
  it('says up, down, same — and "Quiet so far" when nothing came in today', () => {
    expect(vsYesterday(38, 26)).toBe('+12 vs yesterday');
    expect(vsYesterday(4, 7)).toBe('−3 vs yesterday');
    expect(vsYesterday(5, 5)).toBe('same as yesterday');
    expect(vsYesterday(0, 9)).toBe('Quiet so far');
  });
});

describe('quietDay', () => {
  const s = (over: Partial<DashboardSummary>): DashboardSummary => ({
    pendingVerification: 0,
    today: zero,
    yesterday: zero,
    holdsExpiringSoon: 0,
    revenueByEvent: new Map(),
    recentOrders: [],
    ...over,
  });
  it('only when nothing waits on a person, no hold is running out and no order came today', () => {
    expect(quietDay(s({}))).toBe(true);
    expect(quietDay(s({ pendingVerification: 1 }))).toBe(false);
    expect(quietDay(s({ holdsExpiringSoon: 1 }))).toBe(false);
    expect(quietDay(s({ today: { ...zero, ordersPlaced: 1 } }))).toBe(false);
    // Yesterday's busyness does not make today loud.
    expect(quietDay(s({ yesterday: { ...zero, ordersPlaced: 40 } }))).toBe(true);
  });
});

describe('dashboardService.summary', () => {
  it('asks for today and yesterday in Dhaka, the next 2 h of holds, and the 5 newest orders', async () => {
    const today: DayTotals = { ordersPlaced: 12, approvedOrders: 9, approvedPaisa: 1_080_000 };
    const yesterday: DayTotals = { ordersPlaced: 8, approvedOrders: 7, approvedPaisa: 840_000 };
    const deps = {
      orders: {
        countByStatus: vi.fn(async () => 4),
        search: vi.fn(async () => ({ total: 1, rows: [] })),
      },
      reports: {
        dayTotals: vi.fn(async (from: Date) =>
          from.toISOString() === '2026-09-24T18:00:00.000Z' ? today : yesterday,
        ),
        holdsExpiring: vi.fn(async () => 2),
        totalsByEventAndStatus: vi.fn(async () => [
          { eventId: 'a', status: 'issued' as const, count: 3, totalPaisa: 360_000 },
          { eventId: 'a', status: 'paid' as const, count: 1, totalPaisa: 120_000 },
          { eventId: 'a', status: 'pending_verification' as const, count: 2, totalPaisa: 240_000 },
          { eventId: 'b', status: 'cancelled' as const, count: 1, totalPaisa: 120_000 },
        ]),
      },
    } satisfies DashboardDeps;

    const s = await createDashboardService(deps, { now: () => NOW }).summary();

    expect(deps.orders.countByStatus).toHaveBeenCalledWith('pending_verification');
    expect(deps.reports.dayTotals).toHaveBeenCalledWith(
      new Date('2026-09-24T18:00:00Z'),
      new Date('2026-09-25T18:00:00Z'),
    );
    expect(deps.reports.dayTotals).toHaveBeenCalledWith(
      new Date('2026-09-23T18:00:00Z'),
      new Date('2026-09-24T18:00:00Z'),
    );
    expect(deps.reports.holdsExpiring).toHaveBeenCalledWith(
      NOW,
      new Date(NOW.getTime() + EXPIRING_WITHIN_HOURS * 3_600_000),
    );
    expect(deps.orders.search).toHaveBeenCalledWith({}, { limit: RECENT_ORDERS, offset: 0 });
    expect(s).toMatchObject({ pendingVerification: 4, today, yesterday, holdsExpiringSoon: 2 });
    // Revenue per event = paid + issued only; held and cancelled money is not revenue.
    expect([...s.revenueByEvent]).toEqual([['a', 480_000]]);
  });
});
