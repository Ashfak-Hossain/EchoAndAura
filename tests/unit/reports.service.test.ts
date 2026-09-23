import { describe, expect, it } from 'vitest';
import { EventNotFoundError } from '@/server/lib/errors';
import type { EventRecord } from '@/server/repositories/events.repository';
import type { StatusTotal } from '@/server/repositories/orders.repository';
import type { ReportsRepository, TicketTypeSales } from '@/server/repositories/reports.repository';
import { createReportsService, type ReportsDeps } from '@/server/services/reports.service';

/**
 * B12 service with in-memory repositories: the report is assembled from
 * the aggregate rows exactly once each, the derived figures are right, and
 * the empty event reads as "no sales yet" rather than as NaN.
 */
const NOW = new Date('2026-09-21T06:00:00Z'); // Mon 21 Sep 12:00 Dhaka

const event: EventRecord = {
  id: 'ev-1',
  slug: 'live',
  title: 'Echo & Aura Live',
  description: null,
  venue: null,
  startsAt: new Date('2026-10-01T13:00:00Z'),
  endsAt: null,
  registrationOpensAt: new Date('2026-09-11T04:00:00Z'),
  registrationClosesAt: new Date('2026-09-26T13:00:00Z'),
  status: 'published',
  imageKey: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const types: TicketTypeSales[] = [
  {
    ticketTypeId: 'tt-1',
    name: 'General',
    pricePaisa: 120_000,
    quantityTotal: 100,
    quantitySold: 38, // 40 issued, 2 cancelled: the counter is net
    quantityReserved: 3,
    orderCount: 20,
    revenuePaisa: 4_700_000,
    discountPaisa: 100_000,
  },
  {
    ticketTypeId: 'tt-2',
    name: 'VIP',
    pricePaisa: 350_000,
    quantityTotal: 20,
    quantitySold: 4,
    quantityReserved: 0,
    orderCount: 2,
    revenuePaisa: 1_400_000,
    discountPaisa: 0,
  },
];

const byStatus: StatusTotal[] = [
  { status: 'pending_payment', count: 2, totalPaisa: 240_000, compCount: 0 },
  { status: 'pending_verification', count: 1, totalPaisa: 120_000, compCount: 0 },
  { status: 'issued', count: 22, totalPaisa: 6_100_000, compCount: 0 },
  { status: 'expired', count: 3, totalPaisa: 360_000, compCount: 0 },
];

function deps(over: Partial<ReportsRepository> = {}, hasEvent = true): ReportsDeps {
  const reports: ReportsRepository = {
    salesByTicketType: async () => types,
    dailySales: async () => [
      { day: '2026-09-12', orders: 5, tickets: 10, paisa: 1_200_000 },
      { day: '2026-09-20', orders: 15, tickets: 30, paisa: 4_300_000 },
      { day: '2026-09-21', orders: 2, tickets: 4, paisa: 600_000 },
    ],
    timings: async () => ({ toPayMedianS: 3600, toPayN: 23, toVerifyMedianS: 5400, toVerifyN: 22 }),
    ordersByWeekdayHour: async () => [{ dow: 1, hour: 21, n: 28 }],
    orderSizes: async () => [{ quantity: 2, n: 22 }],
    countCancelledTickets: async () => 2,
    complimentary: async () => ({ liveTicketsByType: [] }),
    totalsByEventAndStatus: async () => byStatus.map((t) => ({ eventId: event.id, ...t })),
    ...over,
  };
  return {
    events: {
      findById: async (id) => (hasEvent && id === event.id ? event : null),
      list: async () => (hasEvent ? [event] : []),
    },
    ticketTypes: {
      capacityByEvent: async (ids) =>
        ids.map((eventId) => ({ eventId, total: 120, sold: 42, held: 3, fromPricePaisa: 120_000 })),
    },
    orders: { totalsByStatus: async () => byStatus },
    reports,
  };
}

describe('reportsService.salesReport', () => {
  it('throws EventNotFoundError for an unknown event', async () => {
    const service = createReportsService(deps({}, false), { now: () => NOW });
    await expect(service.salesReport('nope', '14')).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it('assembles seats, money, pending, deltas and the series for the window', async () => {
    const service = createReportsService(deps(), { now: () => NOW });
    const r = await service.salesReport(event.id, '14');

    expect(r.window).toMatchObject({ from: '2026-09-08', to: '2026-09-21', days: 14 });
    // Seats are the net counters (42); verified quantity is gross (44 — two later cancelled).
    expect(r.seats).toEqual({ sold: 42, total: 120, held: 3, left: 75, soldPct: 35 });
    // Revenue = the status totals (paid + issued), not the per-type sums — one definition.
    // The average is per verified ticket (44), not per seat still sold (42).
    expect(r.revenue).toEqual({
      paisa: 6_100_000,
      orders: 22,
      discountPaisa: 100_000,
      avgTicketPaisa: Math.round(6_100_000 / 44),
    });
    expect(r.revenue.avgTicketPaisa).not.toBe(Math.round(6_100_000 / 42));
    expect(r.pending).toEqual({ orders: 3, toVerify: 1, paisa: 360_000 });
    expect(r.cancelledTickets).toBe(2);
    expect(r.funnel).toMatchObject({ placed: 28, submitted: 23, verified: 22, conversionPct: 79 });

    expect(r.period.current).toEqual({ orders: 22, tickets: 44, paisa: 6_100_000 });
    // The 14 days before 8 Sep hold nothing → "new".
    expect(r.period.prior).toEqual({ orders: 0, tickets: 0, paisa: 0 });
    expect(r.period.tickets).toMatchObject({ change: 44, pct: null });
    expect(r.pace7).toBe(4.9); // 34 tickets over 15–21 Sep
    expect(r.daily.points).toHaveLength(14);
    expect(r.daily.peak?.day).toBe('2026-09-20');
    expect(r.cumulative.end).toBe(44);
    expect(r.orderSize).toMatchObject({ orders: 22, tickets: 44, average: 2 });
    expect(r.daily.points.at(-1)?.isToday).toBe(true);
    expect(r.whenPeopleRegister.peakHour).toBe(21);
    expect(r.timings.toVerifyMedianS).toBe(5400);
    expect(r.byTicketType.map((t) => t.name)).toEqual(['General', 'VIP']);
    expect(r.complimentary).toEqual({ tickets: 0, orders: 0 });
    expect(r.noSalesYet).toBe(false);
    expect(r.generatedAt).toBe(NOW);
  });

  it('B13: comps are seats, not buyers — counted on their own, out of the funnel and revenue', async () => {
    // Two comp orders on VIP, both `issued` inside the status totals (at ৳0), plus
    // one fully cancelled comp: 3 tickets still live.
    const withComps: StatusTotal[] = [
      ...byStatus.map((s) =>
        s.status === 'issued' ? { ...s, count: s.count + 2, compCount: 2 } : s,
      ),
      { status: 'cancelled', count: 1, totalPaisa: 0, compCount: 1 },
    ];
    const service = createReportsService(
      {
        ...deps({
          complimentary: async () => ({
            liveTicketsByType: [{ ticketTypeId: 'tt-2', tickets: 3 }],
          }),
        }),
        orders: { totalsByStatus: async () => withComps },
      },
      { now: () => NOW },
    );
    const r = await service.salesReport(event.id, '14');
    expect(r.complimentary).toEqual({ tickets: 3, orders: 3 });
    expect(r.byTicketType.map((t) => t.compTickets)).toEqual([0, 3]);
    // Exactly the figures of the comp-free report: comps never read as buyers,
    // and a fully cancelled comp leaves no "cancelled" row in the funnel.
    expect(r.revenue).toMatchObject({ paisa: 6_100_000, orders: 22 });
    expect(r.funnel).toMatchObject({ placed: 28, verified: 22, conversionPct: 79 });
    expect(r.funnel.cancelled.count).toBe(0);
  });

  it('no range in the URL: 14 days for a live event, all time for a finished one', async () => {
    const live = createReportsService(deps(), { now: () => NOW });
    expect((await live.salesReport(event.id)).window).toMatchObject({ range: '14', days: 14 });

    // Seven weeks after the show: the window ends on the event day, not today, and no bar is "today".
    const later = new Date('2026-11-15T06:00:00Z');
    const finished = createReportsService(deps(), { now: () => later });
    const r = await finished.salesReport(event.id);
    expect(r.window).toMatchObject({
      range: 'all',
      from: '2026-09-11',
      to: '2026-10-01',
      days: 21,
      today: '2026-11-15',
    });
    expect(r.daily.points.some((p) => p.isToday)).toBe(false);
    expect(r.period.prior).toBeNull();
    // An explicit range on a finished event still ends on the event day.
    expect((await finished.salesReport(event.id, '14')).window).toMatchObject({
      from: '2026-09-18',
      to: '2026-10-01',
    });
  });

  it('"all" runs from registration opening (or the first sale) and has no prior period', async () => {
    const service = createReportsService(deps(), { now: () => NOW });
    const r = await service.salesReport(event.id, 'all');
    expect(r.window).toMatchObject({ from: '2026-09-11', days: 11 });
    expect(r.period.prior).toBeNull();
    expect(r.period.tickets).toBeNull();

    const early = createReportsService(
      deps({
        dailySales: async () => [{ day: '2026-09-01', orders: 1, tickets: 1, paisa: 120_000 }],
      }),
      { now: () => NOW },
    );
    expect((await early.salesReport(event.id, 'all')).window.from).toBe('2026-09-01');
  });

  it('an event with nothing verified is "no sales yet" with zero-safe figures', async () => {
    const service = createReportsService(
      {
        ...deps({
          dailySales: async () => [],
          orderSizes: async () => [],
          timings: async () => ({
            toPayMedianS: null,
            toPayN: 0,
            toVerifyMedianS: null,
            toVerifyN: 0,
          }),
          countCancelledTickets: async () => 0,
        }),
        orders: {
          totalsByStatus: async () => [
            { status: 'pending_payment', count: 1, totalPaisa: 120_000, compCount: 0 },
          ],
        },
      },
      { now: () => NOW },
    );
    const r = await service.salesReport(event.id, '30');
    expect(r.noSalesYet).toBe(true);
    expect(r.revenue).toMatchObject({ paisa: 0, orders: 0, avgTicketPaisa: 0 });
    expect(r.pending).toEqual({ orders: 1, toVerify: 0, paisa: 120_000 });
    expect(r.funnel.conversionPct).toBe(0);
    expect(r.daily.peak).toBeNull();
    expect(r.pace7).toBe(0);
    expect(r.period.tickets).toMatchObject({ change: 0, pct: null });
  });
});

describe('reportsService.overview', () => {
  it('one row per event with seats, revenue and pending money split by status', async () => {
    const service = createReportsService(deps(), { now: () => NOW });
    const rows = await service.overview();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      seats: { total: 120, sold: 42, held: 3 },
      revenuePaisa: 6_100_000,
      revenueOrders: 22,
      pendingPaisa: 360_000,
      pendingOrders: 3,
    });
  });

  it('is empty with no events', async () => {
    const service = createReportsService(deps({}, false), { now: () => NOW });
    expect(await service.overview()).toEqual([]);
  });
});
