import { EventNotFoundError } from '@/server/lib/errors';
import { REVENUE_STATUSES, holdsInventory } from '@/server/lib/order-status';
import { averagePaisa } from '@/server/lib/money';
import {
  cumulativeSeries,
  dailySeries,
  delta,
  funnel,
  histograms,
  orderSizeStats,
  percent,
  periodTotals,
  rangeWindow,
  shiftDay,
  type CumulativeSeries,
  type DailySeries,
  type Delta,
  type Funnel,
  type Histograms,
  type OrderSizeStats,
  type PeriodTotals,
  type ReportRange,
  type ReportWindow,
} from '@/server/lib/sales-report';
import type { EventRecord, EventsRepository } from '@/server/repositories/events.repository';
import type { OrdersRepository, StatusTotal } from '@/server/repositories/orders.repository';
import type {
  ReportsRepository,
  TicketTypeSales,
  Timings,
} from '@/server/repositories/reports.repository';
import type { TicketTypesRepository } from '@/server/repositories/ticket-types.repository';
import { dhakaDay } from '@/lib/time';

/**
 * B12 sales report. Reads only — it assembles one typed object per event
 * from the aggregate queries (run in parallel) and the pure helpers in
 * lib/sales-report.ts. Nothing is cached: the numbers are live on every
 * load, which is the point of a report the organizer opens mid-campaign.
 *
 * Definitions, shared with the Orders screen (B9) so both agree:
 * - revenue = orders in REVENUE_STATUSES (money received and kept; a
 *   partially cancelled order stays counted — ADR-024)
 * - seats sold/held = the ticket-type counters (the inventory truth,
 *   net of cancellations — the same number the public stock shows)
 * - the day of a sale = the day it was approved (the audit row)
 */

export interface ReportsDeps {
  events: Pick<EventsRepository, 'findById' | 'list'>;
  ticketTypes: Pick<TicketTypesRepository, 'capacityByEvent'>;
  orders: Pick<OrdersRepository, 'totalsByStatus'>;
  reports: ReportsRepository;
}

export interface SalesReport {
  event: EventRecord;
  window: ReportWindow;
  generatedAt: Date;
  seats: { sold: number; total: number; held: number; left: number; soldPct: number };
  revenue: { paisa: number; orders: number; discountPaisa: number; avgTicketPaisa: number };
  pending: { orders: number; toVerify: number; paisa: number };
  cancelledTickets: number;
  /** This window against the same number of days before it; null for "all". */
  period: {
    current: PeriodTotals;
    prior: PeriodTotals | null;
    tickets: Delta | null;
    paisa: Delta | null;
  };
  /** Tickets per day over the last 7 days, one decimal. */
  pace7: number;
  daily: DailySeries;
  cumulative: CumulativeSeries;
  funnel: Funnel;
  timings: Timings;
  orderSize: OrderSizeStats;
  whenPeopleRegister: Histograms;
  byTicketType: TicketTypeReport[];
  /** B13: comps are seats, not sales — counted here and nowhere in revenue or the funnel. */
  complimentary: { tickets: number; orders: number };
  /** True until the first payment is approved: the design's empty state. */
  noSalesYet: boolean;
}

export interface TicketTypeReport extends TicketTypeSales {
  /** Live complimentary tickets on this type (already inside `quantitySold`). */
  compTickets: number;
}

export interface EventOverviewRow {
  event: EventRecord;
  seats: { total: number; sold: number; held: number };
  revenuePaisa: number;
  revenueOrders: number;
  pendingPaisa: number;
  pendingOrders: number;
}

export function createReportsService(
  { events, ticketTypes, orders, reports }: ReportsDeps,
  { now = () => new Date() }: { now?: () => Date } = {},
) {
  return {
    /**
     * `range` undefined = the URL named none: 14 days for a live event, all
     * time for a finished one (its last fortnight is empty by definition).
     * @throws EventNotFoundError
     */
    async salesReport(eventId: string, range?: ReportRange): Promise<SalesReport> {
      const event = await events.findById(eventId);
      if (!event) throw new EventNotFoundError(eventId);

      const [sales, dailyRows, allByStatus, timings, weekdayHour, sizes, cancelledTickets, comp] =
        await Promise.all([
          reports.salesByTicketType(eventId),
          reports.dailySales(eventId),
          orders.totalsByStatus({ eventId }),
          reports.timings(eventId),
          reports.ordersByWeekdayHour(eventId),
          reports.orderSizes(eventId),
          reports.countCancelledTickets(eventId),
          reports.complimentary(eventId),
        ]);
      // The funnel describes buyers; a comp was never placed or paid for.
      // Its count comes from the same status query, so the two always agree.
      const byStatus = withoutComps(allByStatus);
      const compByType = new Map(comp.liveTicketsByType.map((c) => [c.ticketTypeId, c.tickets]));
      const byTicketType: TicketTypeReport[] = sales.map((t) => ({
        ...t,
        compTickets: compByType.get(t.ticketTypeId) ?? 0,
      }));

      const generatedAt = now();
      const today = dhakaDay(generatedAt);
      const opened = event.registrationOpensAt ? dhakaDay(event.registrationOpensAt) : null;
      const firstSale = dailyRows[0]?.day ?? null;
      const lastSale = dailyRows.at(-1)?.day ?? null;
      const earliest = [opened, firstSale].filter((d): d is string => d !== null).sort()[0] ?? null;
      // A finished event's window ends on its day (or its last sale, if an
      // admin approved something later) — never on today, which would draw
      // weeks of empty bars after the show.
      const eventDay = dhakaDay(event.startsAt);
      const finished = event.startsAt.getTime() < generatedAt.getTime();
      const to = finished ? [eventDay, lastSale ?? eventDay].sort().at(-1)! : today;
      const window = rangeWindow(
        range ?? (finished ? 'all' : '14'),
        to < today ? to : today,
        earliest,
        today,
      );

      const seats = byTicketType.reduce(
        (s, t) => ({
          sold: s.sold + t.quantitySold,
          total: s.total + t.quantityTotal,
          held: s.held + t.quantityReserved,
        }),
        { sold: 0, total: 0, held: 0 },
      );
      const f = funnel(byStatus);
      const orderSize = orderSizeStats(sizes);
      const discountPaisa = byTicketType.reduce((n, t) => n + t.discountPaisa, 0);

      const current = periodTotals(dailyRows, window.from, window.to);
      const prior =
        window.range === 'all'
          ? null
          : periodTotals(dailyRows, shiftDay(window.from, -window.days), shiftDay(window.from, -1));
      const last7 = periodTotals(dailyRows, shiftDay(today, -6), today);

      return {
        event,
        window,
        generatedAt,
        seats: {
          ...seats,
          left: Math.max(0, seats.total - seats.sold - seats.held),
          soldPct: percent(seats.sold, seats.total),
        },
        revenue: {
          paisa: f.verifiedMoney.paisa,
          orders: f.verifiedMoney.count,
          discountPaisa,
          // Per ticket in verified orders (not per seat still sold): what a
          // buyer paid on average, after discounts.
          avgTicketPaisa: averagePaisa(f.verifiedMoney.paisa, orderSize.tickets),
        },
        pending: {
          orders: f.pendingPayment.count + f.pendingVerification.count,
          toVerify: f.pendingVerification.count,
          paisa: f.pendingPayment.paisa + f.pendingVerification.paisa,
        },
        cancelledTickets,
        period: {
          current,
          prior,
          tickets: prior ? delta(current.tickets, prior.tickets) : null,
          paisa: prior ? delta(current.paisa, prior.paisa) : null,
        },
        pace7: Math.round((last7.tickets / 7) * 10) / 10,
        daily: dailySeries(dailyRows, window),
        cumulative: cumulativeSeries(dailyRows, window),
        funnel: f,
        timings,
        orderSize,
        whenPeopleRegister: histograms(weekdayHour),
        byTicketType,
        complimentary: {
          tickets: byTicketType.reduce((n, t) => n + t.compTickets, 0),
          orders: allByStatus.reduce((n, s) => n + s.compCount, 0),
        },
        noSalesYet: f.verifiedMoney.count === 0 && dailyRows.length === 0,
      };
    },

    /** Every event, newest first, with its seats and money at a glance. */
    async overview(): Promise<EventOverviewRow[]> {
      const all = await events.list();
      if (all.length === 0) return [];
      const [capacity, totals] = await Promise.all([
        ticketTypes.capacityByEvent(all.map((e) => e.id)),
        reports.totalsByEventAndStatus(),
      ]);
      const cap = new Map(capacity.map((c) => [c.eventId, c]));
      const rows = new Map<string, EventOverviewRow>(
        all.map((event) => {
          const c = cap.get(event.id);
          return [
            event.id,
            {
              event,
              seats: { total: c?.total ?? 0, sold: c?.sold ?? 0, held: c?.held ?? 0 },
              revenuePaisa: 0,
              revenueOrders: 0,
              pendingPaisa: 0,
              pendingOrders: 0,
            },
          ];
        }),
      );
      for (const t of totals) {
        const row = rows.get(t.eventId);
        if (!row) continue;
        if (REVENUE_STATUSES.includes(t.status)) {
          row.revenuePaisa += t.totalPaisa;
          row.revenueOrders += t.count;
        } else if (holdsInventory(t.status)) {
          row.pendingPaisa += t.totalPaisa;
          row.pendingOrders += t.count;
        }
      }
      return [...rows.values()];
    },
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;

/** Status totals with comp orders taken out (a comp adds ৳0, so only counts move). */
export function withoutComps(all: readonly StatusTotal[]): StatusTotal[] {
  return all
    .map((row) => ({ ...row, count: row.count - row.compCount, compCount: 0 }))
    .filter((row) => row.count > 0);
}
