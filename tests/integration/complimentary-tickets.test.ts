import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import { SoldOutError } from '@/server/lib/errors';
import { isCheckViolation } from '@/server/lib/pg-errors';
import { eventsRepository } from '@/server/repositories/events.repository';
import { inventoryRepository } from '@/server/repositories/inventory.repository';
import { ordersRepository } from '@/server/repositories/orders.repository';
import { reportsRepository } from '@/server/repositories/reports.repository';
import { ticketTypesRepository } from '@/server/repositories/ticket-types.repository';
import { ticketsRepository } from '@/server/repositories/tickets.repository';
import { createFulfilmentService } from '@/server/services/fulfilment.service';
import { createInventoryService } from '@/server/services/inventory.service';
import { createOrdersService } from '@/server/services/orders.service';

/**
 * B13 against real Postgres: a comp moves the real counters and writes one
 * audit row; the database itself refuses a comp that is not wholly free or
 * that carries a trxID or a code; a comp and a public order racing for the
 * last seats go through the same atomic hold, so exactly one wins; and the
 * report counts comps as seats, never as discount or buyer orders.
 */
// Later than the other files' clock: the race below may leave a public
// pending_payment order behind, and the orders suite's expiry run (at its
// NOW + 25 h) expires every lapsed hold in the shared database. A hold taken
// at this clock outlives it. Registration is still open (closes 26 Sep).
const NOW = new Date('2026-09-25T00:00:00Z');

describe('complimentary tickets (Postgres)', () => {
  const eventId = randomUUID();
  const slug = `comp-${eventId}`;
  const general = randomUUID();
  const vip = randomUUID();
  const lastThree = randomUUID();

  const inventory = createInventoryService(inventoryRepository);
  const fulfilment = createFulfilmentService({
    orders: ordersRepository,
    tickets: ticketsRepository,
    ticketTypes: ticketTypesRepository,
    inventory,
    runInTransaction: (fn) => db.transaction(fn),
    onTicketsIssued: async () => {},
  });
  const orders = createOrdersService({
    orders: ordersRepository,
    tickets: ticketsRepository,
    events: eventsRepository,
    ticketTypes: ticketTypesRepository,
    inventory,
    runInTransaction: (fn) => db.transaction(fn),
    now: () => NOW,
  });
  const comp = (ticketTypeId: string, quantity: number) =>
    fulfilment.issueComplimentaryTickets({
      eventId,
      ticketTypeId,
      quantity,
      guestName: 'Tahmina Akter',
      guestEmail: 'tahmina@dhakapress.com',
      reason: 'Press review',
      actor: 'raj@example.com',
    });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.events).values({
      id: eventId,
      slug,
      title: 'Comp Test Event',
      startsAt: new Date('2026-10-01T13:00:00Z'),
      registrationOpensAt: new Date('2026-09-11T13:00:00Z'),
      registrationClosesAt: new Date('2026-09-26T13:00:00Z'),
      status: 'published',
    });
    await db.insert(schema.ticketTypes).values([
      { id: general, eventId, name: 'General', pricePaisa: 120_000, quantityTotal: 50 },
      { id: vip, eventId, name: 'VIP', pricePaisa: 350_000, quantityTotal: 10 },
      { id: lastThree, eventId, name: 'Last three', pricePaisa: 100_000, quantityTotal: 3 },
    ]);
  });

  afterAll(async () => {
    const ids = (
      await db
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .where(eq(schema.orders.eventId, eventId))
    ).map((r) => r.id);
    if (ids.length > 0) {
      await db.delete(schema.tickets).where(inArray(schema.tickets.orderId, ids));
      await db.delete(schema.orders).where(inArray(schema.orders.id, ids));
    }
    await db.delete(schema.ticketTypes).where(eq(schema.ticketTypes.eventId, eventId));
    await db.delete(schema.events).where(eq(schema.events.id, eventId));
    await queryClient.end();
  });

  it('moves the real counters, is born issued at ৳0, writes tickets and one audit row', async () => {
    const { order, tickets } = await comp(vip, 2);

    const [type] = await db.select().from(schema.ticketTypes).where(eq(schema.ticketTypes.id, vip));
    expect(type).toMatchObject({ quantitySold: 2, quantityReserved: 0 });

    const row = await ordersRepository.findById(order.id);
    expect(row).toMatchObject({
      status: 'issued',
      subtotalPaisa: 700_000,
      discountPaisa: 700_000,
      totalPaisa: 0,
      buyerPhone: null,
      complimentaryReason: 'Press review',
    });
    expect(await ticketsRepository.listByOrder(order.id)).toHaveLength(2);
    expect(tickets.map((t) => t.position)).toEqual([1, 2]);

    const events = await ordersRepository.listEvents(order.id);
    expect(events.map((e) => [e.action, e.fromStatus, e.toStatus])).toEqual([
      ['order.comp_issued', null, 'issued'],
    ]);
  });

  it('the database refuses a comp that is not wholly free, or that carries a trxID or a code', async () => {
    const base = {
      eventId,
      ticketTypeId: general,
      quantity: 1,
      unitPricePaisa: 120_000,
      subtotalPaisa: 120_000,
      buyerName: 'Guest',
      buyerEmail: 'g@example.com',
      buyerPhone: null,
      status: 'issued' as const,
      complimentaryReason: 'Press',
    };
    const attempt = (over: Partial<typeof schema.orders.$inferInsert>) =>
      db
        .insert(schema.orders)
        .values({
          ...base,
          reference: `EA-${randomUUID().slice(0, 6).toUpperCase()}`,
          discountPaisa: 120_000,
          totalPaisa: 0,
          ...over,
        })
        .then(
          () => null,
          (e: unknown) => e,
        );

    // Half price is a promo, not a comp.
    expect(
      isCheckViolation(
        await attempt({ discountPaisa: 60_000, totalPaisa: 60_000 }),
        'orders_complimentary_free',
      ),
    ).toBe(true);
    expect(
      isCheckViolation(await attempt({ bkashTrxId: 'AB12CD34EF' }), 'orders_complimentary_free'),
    ).toBe(true);
    // Not a comp, but still wholly consistent money: the old checks are untouched.
    expect(isCheckViolation(await attempt({ totalPaisa: 5 }), 'orders_totals_consistent')).toBe(
      true,
    );
    // A comp is never pending — the expiry job and the queue must never see one.
    expect(
      isCheckViolation(await attempt({ status: 'pending_payment' }), 'orders_complimentary_status'),
    ).toBe(true);
    // Only a comp may lack a phone: a buyer order without one could never be found again.
    expect(
      isCheckViolation(
        await attempt({
          complimentaryReason: null,
          status: 'pending_payment',
          discountPaisa: 0,
          totalPaisa: 120_000,
        }),
        'orders_phone_unless_comp',
      ),
    ).toBe(true);
  });

  it('a comp and a public order racing for the last three seats: exactly one wins', async () => {
    const results = await Promise.allSettled([
      comp(lastThree, 3),
      orders.createOrder({
        eventSlug: slug,
        ticketTypeId: lastThree,
        quantity: 3,
        buyerName: 'Nusrat Jahan',
        buyerEmail: 'n@example.com',
        buyerPhone: '+8801712345678',
        attendeeNames: ['Nusrat Jahan', 'Nusrat Jahan', 'Nusrat Jahan'],
      }),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(SoldOutError);

    const [type] = await db
      .select()
      .from(schema.ticketTypes)
      .where(eq(schema.ticketTypes.id, lastThree));
    expect(type!.quantitySold + type!.quantityReserved).toBe(3);
  });

  it('the report counts comps as seats — not as discount, not as buyer orders', async () => {
    const byType = await reportsRepository.salesByTicketType(eventId);
    const vipRow = byType.find((t) => t.ticketTypeId === vip)!;
    expect(vipRow).toMatchObject({ quantitySold: 2, orderCount: 0, discountPaisa: 0 });

    const c = await reportsRepository.complimentary(eventId);
    const vipComp = c.liveTicketsByType.find((t) => t.ticketTypeId === vip);
    expect(vipComp?.tickets).toBe(2);
    // The status totals B9 and B12 share carry the comp count from the same query.
    const totals = await ordersRepository.totalsByStatus({
      term: null,
      status: null,
      eventId,
      createdFrom: null,
      createdBefore: null,
    });
    const issued = totals.find((t) => t.status === 'issued')!;
    expect(issued.compCount).toBeGreaterThanOrEqual(1);
    expect(issued.count).toBeGreaterThanOrEqual(issued.compCount);

    // A comp is never a sale: not in the daily series, not in order sizes.
    const daily = await reportsRepository.dailySales(eventId);
    expect(daily).toEqual([]);
    expect(await reportsRepository.orderSizes(eventId)).toEqual([]);
  });

  it('cancelling every ticket of a comp: seats back, order cancelled, nothing left counted', async () => {
    const { order, tickets } = await comp(general, 2);
    const soldBefore = (
      await db.select().from(schema.ticketTypes).where(eq(schema.ticketTypes.id, general))
    )[0]!.quantitySold;

    for (const t of tickets) {
      await fulfilment.cancelTicket(t.id, {
        orderId: order.id,
        actor: 'raj@example.com',
        reason: 'Guest cannot come',
      });
    }

    const [type] = await db
      .select()
      .from(schema.ticketTypes)
      .where(eq(schema.ticketTypes.id, general));
    expect(type!.quantitySold).toBe(soldBefore - 2);
    expect((await ordersRepository.findById(order.id))?.status).toBe('cancelled');

    const c = await reportsRepository.complimentary(eventId);
    expect(c.liveTicketsByType.find((t) => t.ticketTypeId === general)).toBeUndefined();
    const totals = await ordersRepository.totalsByStatus({
      term: null,
      status: null,
      eventId,
      createdFrom: null,
      createdBefore: null,
    });
    const cancelled = totals.find((t) => t.status === 'cancelled')!;
    // The only cancelled order here is the comp: the buyer funnel sees none.
    expect(cancelled).toMatchObject({ count: 1, compCount: 1 });

    const events = await ordersRepository.listEvents(order.id);
    expect(events.map((e) => e.action)).toEqual([
      'order.comp_issued',
      'ticket.cancelled',
      'ticket.cancelled',
      'order.cancelled',
    ]);
  });
});
