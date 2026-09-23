import { addDays, addHours } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { REVENUE_STATUSES } from '@/server/lib/order-status';
import type { OrdersRepository, QueueRow } from '@/server/repositories/orders.repository';
import type { DayTotals, ReportsRepository } from '@/server/repositories/reports.repository';
import { DHAKA_TZ, dhakaDay } from '@/lib/time';

/**
 * B3 dashboard numbers — read only. Definitions are B9's and B12's, so the
 * three pages agree: "today" is the Dhaka calendar day; revenue is verified
 * money, dated by the payment.approved row; comps are never orders placed
 * or revenue. The day bounds are worked out here, once, so no query does
 * time-zone arithmetic.
 */

export const RECENT_ORDERS = 5;
export const EXPIRING_WITHIN_HOURS = 2;

export interface DashboardDeps {
  orders: Pick<OrdersRepository, 'countByStatus' | 'search'>;
  reports: Pick<ReportsRepository, 'dayTotals' | 'holdsExpiring' | 'totalsByEventAndStatus'>;
}

export interface DashboardSummary {
  pendingVerification: number;
  today: DayTotals;
  yesterday: DayTotals;
  holdsExpiringSoon: number;
  /** Verified money per event id (paid + issued, comps excluded). */
  revenueByEvent: Map<string, number>;
  recentOrders: QueueRow[];
}

/** The instant a Dhaka calendar day starts, `offset` days from the day `at` falls in. */
export function dhakaDayStart(at: Date, offset = 0): Date {
  return addDays(fromZonedTime(`${dhakaDay(at)}T00:00:00`, DHAKA_TZ), offset);
}

/** "+12 vs yesterday", "−3 vs yesterday", "same as yesterday"; "Quiet so far" with none today. */
export function vsYesterday(today: number, yesterday: number): string {
  if (today === 0) return 'Quiet so far';
  const d = today - yesterday;
  if (d === 0) return 'same as yesterday';
  return `${d > 0 ? '+' : '−'}${Math.abs(d)} vs yesterday`;
}

/** The design's quiet day: nothing waiting on a person, no hold running out, no order today. */
export function quietDay(s: DashboardSummary): boolean {
  return s.pendingVerification === 0 && s.holdsExpiringSoon === 0 && s.today.ordersPlaced === 0;
}

export function createDashboardService(
  { orders, reports }: DashboardDeps,
  { now = () => new Date() }: { now?: () => Date } = {},
) {
  return {
    async summary(): Promise<DashboardSummary> {
      const at = now();
      const todayStart = dhakaDayStart(at);
      const tomorrowStart = dhakaDayStart(at, 1);
      const yesterdayStart = dhakaDayStart(at, -1);

      const [pendingVerification, today, yesterday, holdsExpiringSoon, totals, recent] =
        await Promise.all([
          orders.countByStatus('pending_verification'),
          reports.dayTotals(todayStart, tomorrowStart),
          reports.dayTotals(yesterdayStart, todayStart),
          reports.holdsExpiring(at, addHours(at, EXPIRING_WITHIN_HOURS)),
          reports.totalsByEventAndStatus(),
          orders.search({}, { limit: RECENT_ORDERS, offset: 0 }),
        ]);

      const revenueByEvent = new Map<string, number>();
      for (const t of totals) {
        if (!REVENUE_STATUSES.includes(t.status)) continue;
        revenueByEvent.set(t.eventId, (revenueByEvent.get(t.eventId) ?? 0) + t.totalPaisa);
      }

      return {
        pendingVerification,
        today,
        yesterday,
        holdsExpiringSoon,
        revenueByEvent,
        recentOrders: recent.rows,
      };
    },
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
