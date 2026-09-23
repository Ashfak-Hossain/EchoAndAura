import { alias, type PgColumn } from 'drizzle-orm/pg-core';
import { and, asc, count, eq, inArray, isNotNull, isNull, sql, sum, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { orderEvents, orders, ticketTypes, tickets } from '@/db/schema';
import { type OrderStatus, REVENUE_STATUSES } from '@/server/lib/order-status';
import type { DailySalesRow, OrderSizeRow, WeekdayHourRow } from '@/server/lib/sales-report';
import { DHAKA_TZ } from '@/lib/time';

/**
 * B12 read models: aggregate queries only, nothing is ever written here.
 * Each method is one statement scoped to an event. Money comes back from
 * `sum()` as a string (bigint-safe) and is converted with `Number()` —
 * totals fit a number for any plausible organizer (MAX_SAFE_INTEGER paisa
 * ≈ ৳90 trillion). Calendar buckets are Dhaka days/hours computed in SQL
 * so the code never does offset arithmetic.
 *
 * Complimentary orders (B13) are seats, not buyers: they are in the
 * inventory counters (they fill the room) and out of every figure that
 * describes sales — verified-order counts, the daily series, discounts,
 * order sizes, when people register. They are counted on their own by
 * `complimentary`.
 */

export interface TicketTypeSales {
  ticketTypeId: string;
  name: string;
  pricePaisa: number;
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
  /** Verified (paid + issued) buyer orders on this type and their money — comps excluded. */
  orderCount: number;
  revenuePaisa: number;
  discountPaisa: number;
}

export interface ComplimentaryTotals {
  /**
   * Comp tickets still live, per ticket type — net of cancellations, like
   * seats sold. (Comp orders per status come with `orders.totalsByStatus`.)
   */
  liveTicketsByType: { ticketTypeId: string; tickets: number }[];
}

export interface Timings {
  /** Median seconds from order creation to the first trxID submission; null with no sample. */
  toPayMedianS: number | null;
  toPayN: number;
  /** Median seconds from trxID submission to approval; null with no sample. */
  toVerifyMedianS: number | null;
  toVerifyN: number;
}

export interface EventStatusTotal {
  eventId: string;
  status: OrderStatus;
  count: number;
  totalPaisa: number;
}

export interface ReportsRepository {
  /** Every ticket type of the event (LEFT JOIN: a type with no sales is still a row), in list order. */
  salesByTicketType(eventId: string): Promise<TicketTypeSales[]>;
  /**
   * Verified sales per Dhaka day, dated by the `payment.approved` audit row
   * (Invariant 6 is the clock — there is no `paid_at` column). Comps have no
   * such row and are not sales. Unbounded: an event's lifetime is a few
   * hundred days at most.
   */
  dailySales(eventId: string): Promise<DailySalesRow[]>;
  timings(eventId: string): Promise<Timings>;
  /** Buyer orders placed (any status) per Dhaka weekday and hour. */
  ordersByWeekdayHour(eventId: string): Promise<WeekdayHourRow[]>;
  /** Verified buyer orders per quantity. */
  orderSizes(eventId: string): Promise<OrderSizeRow[]>;
  countCancelledTickets(eventId: string): Promise<number>;
  complimentary(eventId: string): Promise<ComplimentaryTotals>;
  /** Every event: buyer-order count and sum(total) per status — the cross-event overview. */
  totalsByEventAndStatus(): Promise<EventStatusTotal[]>;
}

const buyerOrder = isNull(orders.complimentaryReason);

// A literal, not a bound parameter: the same expression appears in SELECT
// and GROUP BY, and Postgres matches those textually — `$1` vs `$2` would
// not match. The zone is a constant of this app, never user input.
const DHAKA = sql.raw(`'${DHAKA_TZ}'`);
const REVENUE: OrderStatus[] = [...REVENUE_STATUSES];

export const reportsRepository: ReportsRepository = {
  async salesByTicketType(eventId) {
    const rows = await db
      .select({
        ticketTypeId: ticketTypes.id,
        name: ticketTypes.name,
        pricePaisa: ticketTypes.pricePaisa,
        quantityTotal: ticketTypes.quantityTotal,
        quantitySold: ticketTypes.quantitySold,
        quantityReserved: ticketTypes.quantityReserved,
        orderCount: count(orders.id),
        revenuePaisa: sum(orders.totalPaisa),
        discountPaisa: sum(orders.discountPaisa),
      })
      .from(ticketTypes)
      .leftJoin(
        orders,
        // A comp's whole price is its "discount": counting it would read as
        // money given away through codes. Comps are counted by `complimentary`.
        and(eq(orders.ticketTypeId, ticketTypes.id), inArray(orders.status, REVENUE), buyerOrder),
      )
      .where(eq(ticketTypes.eventId, eventId))
      .groupBy(ticketTypes.id)
      .orderBy(asc(ticketTypes.createdAt), asc(ticketTypes.id));
    return rows.map((r) => ({
      ...r,
      revenuePaisa: Number(r.revenuePaisa ?? 0),
      discountPaisa: Number(r.discountPaisa ?? 0),
    }));
  },

  async dailySales(eventId) {
    const day = sql<string>`to_char(${orderEvents.createdAt} AT TIME ZONE ${DHAKA}, 'YYYY-MM-DD')`;
    const rows = await db
      .select({
        day,
        orders: count(),
        tickets: sum(orders.quantity),
        paisa: sum(orders.totalPaisa),
      })
      .from(orders)
      .innerJoin(
        orderEvents,
        // Buyer sales only: a comp is never approved, so it has no such row.
        and(eq(orderEvents.orderId, orders.id), eq(orderEvents.action, 'payment.approved')),
      )
      .where(and(eq(orders.eventId, eventId), inArray(orders.status, REVENUE)))
      .groupBy(day)
      .orderBy(day);
    return rows.map((r) => ({
      day: r.day,
      orders: r.orders,
      tickets: Number(r.tickets ?? 0),
      paisa: Number(r.paisa ?? 0),
    }));
  },

  async timings(eventId) {
    // Three self-joins on the audit trail: the moment an order was created,
    // the first trxID submission (`payment.submitted` is written once; later
    // edits are `payment.updated`) and the approval. An order is in a sample
    // only when both of its endpoints exist.
    const created = alias(orderEvents, 'created');
    const submitted = alias(orderEvents, 'submitted');
    const approved = alias(orderEvents, 'approved');
    const seconds = (later: { createdAt: PgColumn }, earlier: { createdAt: PgColumn }) =>
      sql`extract(epoch from (${later.createdAt} - ${earlier.createdAt}))`;
    const median = (expr: SQL) =>
      sql<number | null>`(percentile_cont(0.5) within group (order by ${expr}))::float8`;

    const [pay, verify] = await Promise.all([
      db
        .select({ median: median(seconds(submitted, created)), n: count() })
        .from(orders)
        .innerJoin(
          created,
          and(eq(created.orderId, orders.id), eq(created.action, 'order.created')),
        )
        .innerJoin(
          submitted,
          and(eq(submitted.orderId, orders.id), eq(submitted.action, 'payment.submitted')),
        )
        .where(eq(orders.eventId, eventId)),
      db
        .select({ median: median(seconds(approved, submitted)), n: count() })
        .from(orders)
        .innerJoin(
          submitted,
          and(eq(submitted.orderId, orders.id), eq(submitted.action, 'payment.submitted')),
        )
        .innerJoin(
          approved,
          and(eq(approved.orderId, orders.id), eq(approved.action, 'payment.approved')),
        )
        .where(eq(orders.eventId, eventId)),
    ]);
    const p = pay[0];
    const v = verify[0];
    return {
      toPayMedianS: p?.median ?? null,
      toPayN: p?.n ?? 0,
      toVerifyMedianS: v?.median ?? null,
      toVerifyN: v?.n ?? 0,
    };
  },

  async ordersByWeekdayHour(eventId) {
    const dow = sql<number>`extract(dow from (${orders.createdAt} AT TIME ZONE ${DHAKA}))::int`;
    const hour = sql<number>`extract(hour from (${orders.createdAt} AT TIME ZONE ${DHAKA}))::int`;
    return db
      .select({ dow, hour, n: count() })
      .from(orders)
      .where(and(eq(orders.eventId, eventId), buyerOrder))
      .groupBy(dow, hour);
  },

  async orderSizes(eventId) {
    return db
      .select({ quantity: orders.quantity, n: count() })
      .from(orders)
      .where(and(eq(orders.eventId, eventId), inArray(orders.status, REVENUE), buyerOrder))
      .groupBy(orders.quantity);
  },

  async countCancelledTickets(eventId) {
    const [row] = await db
      .select({ n: count() })
      .from(tickets)
      .where(and(eq(tickets.eventId, eventId), eq(tickets.status, 'cancelled')));
    return row?.n ?? 0;
  },

  async complimentary(eventId) {
    const live = await db
      .select({ ticketTypeId: tickets.ticketTypeId, tickets: count() })
      .from(tickets)
      .innerJoin(orders, eq(orders.id, tickets.orderId))
      .where(
        and(
          eq(orders.eventId, eventId),
          isNotNull(orders.complimentaryReason),
          eq(tickets.status, 'issued'),
        ),
      )
      .groupBy(tickets.ticketTypeId);
    return { liveTicketsByType: live };
  },

  async totalsByEventAndStatus() {
    const rows = await db
      .select({
        eventId: orders.eventId,
        status: orders.status,
        count: count(),
        paisa: sum(orders.totalPaisa),
      })
      .from(orders)
      .where(buyerOrder)
      .groupBy(orders.eventId, orders.status);
    return rows.map((r) => ({
      eventId: r.eventId,
      status: r.status,
      count: r.count,
      totalPaisa: Number(r.paisa ?? 0),
    }));
  },
};
