import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import { TooManyOpenOrdersError } from '@/server/lib/errors';
import { eventsRepository } from '@/server/repositories/events.repository';
import { inventoryRepository } from '@/server/repositories/inventory.repository';
import { ordersRepository } from '@/server/repositories/orders.repository';
import { ticketTypesRepository } from '@/server/repositories/ticket-types.repository';
import { ticketsRepository } from '@/server/repositories/tickets.repository';
import { createInventoryService } from '@/server/services/inventory.service';
import {
  type CreateOrderInput,
  createOrdersService,
  MAX_OPEN_ORDERS_PER_BUYER,
} from '@/server/services/orders.service';

/**
 * Phase 7.6 against real Postgres: one phone may hold only
 * MAX_OPEN_ORDERS_PER_BUYER open orders per event, even when it submits
 * many at the same instant. Without the per-buyer advisory lock, parallel
 * submits would all count zero open orders and all get through.
 */
const NOW = new Date('2026-09-20T10:00:00Z');

describe('open orders per buyer (Postgres)', () => {
  let eventId: string;
  let slug: string;
  let ticketTypeId: string;
  const svc = createOrdersService({
    orders: ordersRepository,
    tickets: ticketsRepository,
    events: eventsRepository,
    ticketTypes: ticketTypesRepository,
    inventory: createInventoryService(inventoryRepository),
    runInTransaction: (fn) => db.transaction(fn),
    now: () => NOW,
  });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    eventId = randomUUID();
    slug = `buyer-cap-${eventId}`;
    await db.insert(schema.events).values({
      id: eventId,
      slug,
      title: 'Buyer Cap Event',
      startsAt: new Date('2026-10-01T13:00:00Z'),
      registrationOpensAt: new Date('2026-09-11T13:00:00Z'),
      registrationClosesAt: new Date('2026-09-26T13:00:00Z'),
      status: 'published',
    });
    ticketTypeId = randomUUID();
    await db.insert(schema.ticketTypes).values({
      id: ticketTypeId,
      eventId,
      name: 'General',
      pricePaisa: 50_000,
      quantityTotal: 100,
    });
  });

  afterAll(async () => {
    await db.delete(schema.orders).where(eq(schema.orders.eventId, eventId));
    await db.delete(schema.events).where(eq(schema.events.id, eventId));
    await queryClient.end();
  });

  const order = (phone: string, quantity = 3): CreateOrderInput => ({
    eventSlug: slug,
    ticketTypeId,
    quantity,
    buyerName: 'Hoarder Test',
    buyerEmail: 'hoarder@example.com',
    buyerPhone: phone,
    attendeeNames: Array.from({ length: quantity }, () => 'Hoarder Test'),
  });

  const reserved = async () => {
    const [row] = await db
      .select()
      .from(schema.ticketTypes)
      .where(eq(schema.ticketTypes.id, ticketTypeId));
    return row?.quantityReserved;
  };

  it('eight submits from one phone at the same instant: exactly the cap get through', async () => {
    const phone = '+8801711111111';
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => svc.createOrder(order(phone))),
    );
    const placed = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof TooManyOpenOrdersError,
    );
    expect(placed).toHaveLength(MAX_OPEN_ORDERS_PER_BUYER);
    expect(refused).toHaveLength(8 - MAX_OPEN_ORDERS_PER_BUYER);
    // Only the placed orders hold seats: a refusal holds nothing.
    expect(await reserved()).toBe(MAX_OPEN_ORDERS_PER_BUYER * 3);
  });

  it('other buyers are not slowed or limited by it', async () => {
    const before = (await reserved()) ?? 0;
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => svc.createOrder(order(`+88018000000${10 + i}`, 1))),
    );
    expect(results).toHaveLength(6);
    expect(await reserved()).toBe(before + 6);
  });

  it('the same phone may order again once its holds have lapsed (24 h later)', async () => {
    const phone = '+8801711111111'; // capped in the first test
    await expect(svc.createOrder(order(phone, 1))).rejects.toBeInstanceOf(TooManyOpenOrdersError);
    const dayLater = createOrdersService({
      orders: ordersRepository,
      tickets: ticketsRepository,
      events: eventsRepository,
      ticketTypes: ticketTypesRepository,
      inventory: createInventoryService(inventoryRepository),
      runInTransaction: (fn) => db.transaction(fn),
      now: () => new Date(NOW.getTime() + 25 * 60 * 60_000),
    });
    // Registration closes 2026-09-26; a day later is still inside the window.
    await expect(dayLater.createOrder(order(phone, 1))).resolves.toMatchObject({
      status: 'pending_payment',
    });
  });
});
