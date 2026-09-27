import { randomUUID } from 'node:crypto';
import { addHours, addMinutes } from 'date-fns';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import { reportsRepository } from '@/server/repositories/reports.repository';

/**
 * B3 read models on Postgres. The window sits in 2031 so no other test
 * file's rows can fall into it (these aggregates span every event).
 */
const FROM = new Date('2031-03-10T18:00:00Z'); // 11 Mar 00:00 Dhaka
const TO = new Date('2031-03-11T18:00:00Z');

describe('dashboard read models (Postgres)', () => {
  const eventId = randomUUID();
  const typeId = randomUUID();
  let n = 0;

  /** A consistent ৳1,200 × 1 order; comps are free in full. */
  const insertOrder = async (
    status: (typeof schema.orderStatus.enumValues)[number],
    createdAt: Date,
    extra: Partial<typeof schema.orders.$inferInsert> = {},
  ) => {
    const comp = extra.complimentaryReason != null;
    const [row] = await db
      .insert(schema.orders)
      .values({
        reference: `EA-D${String(++n).padStart(5, '0')}`,
        eventId,
        ticketTypeId: typeId,
        quantity: 1,
        unitPricePaisa: 120_000,
        subtotalPaisa: 120_000,
        discountPaisa: comp ? 120_000 : 0,
        totalPaisa: comp ? 0 : 120_000,
        status,
        buyerName: 'Test Buyer',
        buyerEmail: 'b@example.com',
        buyerPhone: comp ? null : '+8801712345678',
        createdAt,
        ...extra,
      })
      .returning();
    return row!;
  };
  const approvedAt = (orderId: string, at: Date) =>
    db.insert(schema.orderEvents).values({
      orderId,
      actor: 'admin@example.com',
      action: 'payment.approved',
      fromStatus: 'pending_verification',
      toStatus: 'paid',
      createdAt: at,
    });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.events).values({
      id: eventId,
      slug: `dash-${eventId}`,
      title: 'Dashboard Test',
      startsAt: new Date('2031-04-01T13:00:00Z'),
      status: 'published',
    });
    await db.insert(schema.ticketTypes).values({
      id: typeId,
      eventId,
      name: 'General',
      pricePaisa: 120_000,
      quantityTotal: 100,
    });
  });

  afterAll(async () => {
    await db.delete(schema.orders).where(eq(schema.orders.eventId, eventId));
    await db.delete(schema.ticketTypes).where(eq(schema.ticketTypes.eventId, eventId));
    await db.delete(schema.events).where(eq(schema.events.id, eventId));
    await queryClient.end();
  });

  it('dayTotals: orders placed in [from, to), comps excluded; revenue by approval moment', async () => {
    await insertOrder('pending_payment', addHours(FROM, 1)); // placed today
    const lateYesterday = await insertOrder('issued', addMinutes(FROM, -1)); // placed yesterday…
    await approvedAt(lateYesterday.id, addHours(FROM, 2)); // …approved today → today's revenue
    await insertOrder('issued', addHours(FROM, 3), { complimentaryReason: 'Press' }); // comp
    await insertOrder('pending_payment', TO); // tomorrow (the bound is exclusive)
    const approvedTomorrow = await insertOrder('issued', addHours(FROM, 4));
    await approvedAt(approvedTomorrow.id, addMinutes(TO, 1));
    const cancelled = await insertOrder('cancelled', addHours(FROM, 5));
    await approvedAt(cancelled.id, addHours(FROM, 6)); // money returned: not revenue

    expect(await reportsRepository.dayTotals(FROM, TO)).toEqual({
      ordersPlaced: 3, // pending, approved-tomorrow, cancelled — not the comp, not yesterday's
      approvedOrders: 1,
      approvedPaisa: 120_000,
    });
  });

  it('holdsExpiring: pending_payment holds ending in (from, until] only', async () => {
    const at = new Date('2031-03-20T06:00:00Z');
    await insertOrder('pending_payment', at, { holdExpiresAt: addHours(at, 1) }); // counts
    await insertOrder('pending_payment', at, { holdExpiresAt: addHours(at, 3) }); // later
    await insertOrder('pending_payment', at, { holdExpiresAt: addMinutes(at, -1) }); // lapsed
    await insertOrder('pending_verification', at, { holdExpiresAt: addHours(at, 1) }); // paid, waiting

    expect(await reportsRepository.holdsExpiring(at, addHours(at, 2))).toBe(1);
  });
});
