import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import { reportsRepository } from '@/server/repositories/reports.repository';

/**
 * B12 aggregates against real Postgres: revenue counts paid + issued only,
 * a ticket type with no sales is still a row, days and hours are Dhaka
 * calendar buckets (the midnight boundary is the test), medians come from
 * the audit rows, and one event's numbers never leak into another's.
 */
describe('reportsRepository (Postgres)', () => {
  const eventA = randomUUID();
  const eventB = randomUUID();
  const ttGeneral = randomUUID();
  const ttVip = randomUUID();
  const ttUnsold = randomUUID();
  const ttB = randomUUID();
  const orderIds: string[] = [];
  const ref = () => `RPT-${randomUUID().slice(0, 8).toUpperCase()}`;

  type Status = (typeof schema.orders.$inferInsert)['status'];

  /** An order plus its audit rows at hand-picked instants. */
  async function order(input: {
    eventId: string;
    ticketTypeId: string;
    quantity: number;
    unitPaisa: number;
    discountPaisa?: number;
    status: Status;
    createdAt: Date;
    submittedAt?: Date;
    /** A later trxID edit (`payment.updated`) — must never count as a submission. */
    updatedAt?: Date;
    approvedAt?: Date;
  }) {
    const id = randomUUID();
    orderIds.push(id);
    const subtotal = input.unitPaisa * input.quantity;
    const discount = input.discountPaisa ?? 0;
    await db.insert(schema.orders).values({
      id,
      eventId: input.eventId,
      ticketTypeId: input.ticketTypeId,
      reference: ref(),
      quantity: input.quantity,
      unitPricePaisa: input.unitPaisa,
      subtotalPaisa: subtotal,
      discountPaisa: discount,
      totalPaisa: subtotal - discount,
      buyerName: 'Report Test',
      buyerEmail: `report-${id}@example.com`,
      buyerPhone: '+8801712345678',
      attendeeNames: Array.from({ length: input.quantity }, () => 'Report Test'),
      status: input.status,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
    const events: (typeof schema.orderEvents.$inferInsert)[] = [
      { orderId: id, actor: 'buyer', action: 'order.created', createdAt: input.createdAt },
    ];
    if (input.submittedAt) {
      events.push({
        orderId: id,
        actor: 'buyer',
        action: 'payment.submitted',
        createdAt: input.submittedAt,
      });
    }
    if (input.updatedAt) {
      events.push({
        orderId: id,
        actor: 'buyer',
        action: 'payment.updated',
        createdAt: input.updatedAt,
      });
    }
    if (input.approvedAt) {
      events.push({
        orderId: id,
        actor: 'raj@example.com',
        action: 'payment.approved',
        createdAt: input.approvedAt,
      });
    }
    await db.insert(schema.orderEvents).values(events);
    return id;
  }

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    for (const [id, title] of [
      [eventA, 'Report A'],
      [eventB, 'Report B'],
    ] as const) {
      await db.insert(schema.events).values({
        id,
        slug: `report-${id}`,
        title,
        startsAt: new Date('2026-10-01T13:00:00Z'),
        registrationOpensAt: new Date('2026-09-11T13:00:00Z'),
        registrationClosesAt: new Date('2026-09-26T13:00:00Z'),
        status: 'published',
      });
    }
    // Counters as fulfilment would have left them: sold = live tickets, held = pending.
    await db.insert(schema.ticketTypes).values([
      {
        id: ttGeneral,
        eventId: eventA,
        name: 'General',
        pricePaisa: 120_000,
        quantityTotal: 100,
        quantitySold: 5,
        quantityReserved: 3,
        createdAt: new Date('2026-09-01T00:00:00Z'),
      },
      {
        id: ttVip,
        eventId: eventA,
        name: 'VIP',
        pricePaisa: 350_000,
        quantityTotal: 20,
        quantitySold: 2,
        quantityReserved: 0,
        createdAt: new Date('2026-09-01T00:01:00Z'),
      },
      {
        id: ttUnsold,
        eventId: eventA,
        name: 'Student',
        pricePaisa: 60_000,
        quantityTotal: 30,
        createdAt: new Date('2026-09-01T00:02:00Z'),
      },
      {
        id: ttB,
        eventId: eventB,
        name: 'Other',
        pricePaisa: 100_000,
        quantityTotal: 50,
        quantitySold: 1,
      },
    ]);

    // Event A — verified sales. Approval instants straddle Dhaka midnight:
    // 17:59Z = 23:59 Dhaka on the 15th, 18:01Z = 00:01 Dhaka on the 16th.
    await order({
      eventId: eventA,
      ticketTypeId: ttGeneral,
      quantity: 2,
      unitPaisa: 120_000,
      status: 'issued',
      createdAt: new Date('2026-09-15T15:00:00Z'), // Tue 15 Sep 21:00 Dhaka
      submittedAt: new Date('2026-09-15T16:00:00Z'), // 1 h to pay
      approvedAt: new Date('2026-09-15T17:59:00Z'), // 1h59m to verify
    });
    await order({
      eventId: eventA,
      ticketTypeId: ttGeneral,
      quantity: 3,
      unitPaisa: 120_000,
      discountPaisa: 10_000,
      status: 'issued',
      createdAt: new Date('2026-09-15T15:30:00Z'), // Tue 15 Sep 21:30 Dhaka
      submittedAt: new Date('2026-09-15T17:30:00Z'), // 2 h to pay
      approvedAt: new Date('2026-09-15T18:01:00Z'), // 31 min to verify, just past midnight Dhaka
    });
    await order({
      eventId: eventA,
      ticketTypeId: ttVip,
      quantity: 2,
      unitPaisa: 350_000,
      status: 'paid',
      createdAt: new Date('2026-09-16T04:00:00Z'), // Wed 16 Sep 10:00 Dhaka
      submittedAt: new Date('2026-09-16T09:00:00Z'), // 5 h to pay
      approvedAt: new Date('2026-09-16T10:00:00Z'), // 1 h to verify
    });
    // Money that never counts as revenue.
    await order({
      eventId: eventA,
      ticketTypeId: ttGeneral,
      quantity: 1,
      unitPaisa: 120_000,
      status: 'pending_payment',
      createdAt: new Date('2026-09-17T15:00:00Z'), // Thu 17 Sep 21:00 Dhaka
    });
    await order({
      eventId: eventA,
      ticketTypeId: ttGeneral,
      quantity: 2,
      unitPaisa: 120_000,
      status: 'pending_verification',
      createdAt: new Date('2026-09-17T15:10:00Z'), // Thu 17 Sep 21:10 Dhaka
      submittedAt: new Date('2026-09-17T15:40:00Z'), // 30 min to pay, no approval yet
      updatedAt: new Date('2026-09-17T16:40:00Z'), // edited the trxID later: not a second sample
    });
    await order({
      eventId: eventA,
      ticketTypeId: ttVip,
      quantity: 1,
      unitPaisa: 350_000,
      status: 'rejected',
      createdAt: new Date('2026-09-17T15:20:00Z'),
      submittedAt: new Date('2026-09-17T15:50:00Z'),
    });
    await order({
      eventId: eventA,
      ticketTypeId: ttGeneral,
      quantity: 1,
      unitPaisa: 120_000,
      status: 'expired',
      createdAt: new Date('2026-09-12T15:00:00Z'),
    });
    // Approved, then every ticket cancelled: the order is `cancelled`, its money left.
    const cancelledOrder = await order({
      eventId: eventA,
      ticketTypeId: ttGeneral,
      quantity: 1,
      unitPaisa: 120_000,
      status: 'cancelled',
      createdAt: new Date('2026-09-13T15:00:00Z'),
      submittedAt: new Date('2026-09-13T16:30:00Z'), // 90 min to pay
      approvedAt: new Date('2026-09-13T18:00:00Z'), // 90 min to verify
    });
    await db.insert(schema.tickets).values([
      {
        orderId: cancelledOrder,
        ticketTypeId: ttGeneral,
        eventId: eventA,
        code: `RPT${randomUUID()
          .slice(0, 5)
          .toUpperCase()
          .replace(/[^A-Z2-9]/g, 'X')}`,
        position: 1,
        attendeeName: 'Gone',
        status: 'cancelled',
      },
    ]);
    // Event B — must never leak into A.
    await order({
      eventId: eventB,
      ticketTypeId: ttB,
      quantity: 1,
      unitPaisa: 100_000,
      status: 'issued',
      createdAt: new Date('2026-09-15T15:00:00Z'),
      submittedAt: new Date('2026-09-15T15:10:00Z'),
      approvedAt: new Date('2026-09-15T15:20:00Z'),
    });
  });

  afterAll(async () => {
    await db.delete(schema.tickets).where(inArray(schema.tickets.eventId, [eventA, eventB]));
    await db.delete(schema.orders).where(inArray(schema.orders.id, orderIds));
    await db
      .delete(schema.ticketTypes)
      .where(inArray(schema.ticketTypes.eventId, [eventA, eventB]));
    await db.delete(schema.events).where(inArray(schema.events.id, [eventA, eventB]));
    await queryClient.end();
  });

  it('salesByTicketType: revenue over paid + issued only, unsold types still listed, list order', async () => {
    const rows = await reportsRepository.salesByTicketType(eventA);
    expect(rows.map((r) => r.name)).toEqual(['General', 'VIP', 'Student']);
    const general = rows[0]!;
    // 2 × 1,200 + (3 × 1,200 − 100): pending, rejected, expired and cancelled orders are out.
    expect(general).toMatchObject({
      quantityTotal: 100,
      quantitySold: 5,
      quantityReserved: 3,
      orderCount: 2,
      revenuePaisa: 240_000 + 350_000,
      discountPaisa: 10_000,
    });
    expect(rows[1]).toMatchObject({ orderCount: 1, revenuePaisa: 700_000, discountPaisa: 0 });
    expect(rows[2]).toMatchObject({
      orderCount: 0,
      revenuePaisa: 0,
      discountPaisa: 0,
      quantitySold: 0,
    });
  });

  it('dailySales: buckets by the Dhaka date of the approval row', async () => {
    const rows = await reportsRepository.dailySales(eventA);
    // The cancelled order's approval on the 13th does not count (status cancelled).
    expect(rows).toEqual([
      { day: '2026-09-15', orders: 1, tickets: 2, paisa: 240_000 },
      { day: '2026-09-16', orders: 2, tickets: 5, paisa: 350_000 + 700_000 },
    ]);
  });

  it('timings: medians from the audit rows, only orders with both endpoints', async () => {
    const t = await reportsRepository.timings(eventA);
    // To pay: 1 h, 2 h, 5 h, 30 min (pending_verification — its later
    // `payment.updated` row is not a sample), 30 min (rejected), 90 min
    // (cancelled) → sorted 30, 30, 60, 90, 120, 300 → the continuous median
    // interpolates the middle pair: 75 min.
    expect(t.toPayN).toBe(6);
    expect(t.toPayMedianS).toBe(75 * 60);
    // To verify: 119 min, 31 min, 60 min, 90 min (cancelled) → (60 + 90) / 2 = 75 min.
    expect(t.toVerifyN).toBe(4);
    expect(t.toVerifyMedianS).toBe(75 * 60);
  });

  it('timings: an event with no orders has no sample', async () => {
    expect(await reportsRepository.timings(randomUUID())).toEqual({
      toPayMedianS: null,
      toPayN: 0,
      toVerifyMedianS: null,
      toVerifyN: 0,
    });
  });

  it('ordersByWeekdayHour: Dhaka weekday and hour of every order placed', async () => {
    const rows = await reportsRepository.ordersByWeekdayHour(eventA);
    const at = (dow: number, hour: number) =>
      rows.find((r) => r.dow === dow && r.hour === hour)?.n ?? 0;
    expect(at(2, 21)).toBe(2); // Tue 15 Sep 21:00 + 21:30 Dhaka
    expect(at(3, 10)).toBe(1); // Wed 16 Sep 10:00 Dhaka
    expect(at(4, 21)).toBe(3); // Thu 17 Sep 21:00, 21:10, 21:20 Dhaka
    expect(rows.reduce((n, r) => n + r.n, 0)).toBe(8);
  });

  it('orderSizes: verified orders only', async () => {
    const rows = await reportsRepository.orderSizes(eventA);
    expect(rows.sort((a, b) => a.quantity - b.quantity)).toEqual([
      { quantity: 2, n: 2 },
      { quantity: 3, n: 1 },
    ]);
  });

  it('countCancelledTickets and totalsByEventAndStatus keep events apart', async () => {
    expect(await reportsRepository.countCancelledTickets(eventA)).toBe(1);
    expect(await reportsRepository.countCancelledTickets(eventB)).toBe(0);

    const totals = await reportsRepository.totalsByEventAndStatus();
    const a = totals.filter((t) => t.eventId === eventA);
    const b = totals.filter((t) => t.eventId === eventB);
    expect(a.find((t) => t.status === 'issued')).toMatchObject({ count: 2, totalPaisa: 590_000 });
    expect(a.find((t) => t.status === 'paid')).toMatchObject({ count: 1, totalPaisa: 700_000 });
    expect(a.find((t) => t.status === 'pending_verification')).toMatchObject({
      count: 1,
      totalPaisa: 240_000,
    });
    expect(b).toEqual([{ eventId: eventB, status: 'issued', count: 1, totalPaisa: 100_000 }]);
  });
});
