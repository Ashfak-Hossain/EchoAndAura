import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import { OrderReferenceCollisionError, SoldOutError } from '@/server/lib/errors';
import { eventsRepository } from '@/server/repositories/events.repository';
import { inventoryRepository } from '@/server/repositories/inventory.repository';
import { ordersRepository } from '@/server/repositories/orders.repository';
import { ticketTypesRepository } from '@/server/repositories/ticket-types.repository';
import { createInventoryService } from '@/server/services/inventory.service';
import { type CreateOrderInput, createOrdersService } from '@/server/services/orders.service';

/**
 * Order creation against real Postgres, wired exactly like the container.
 * Proves the three writes commit together, that a sold-out attempt leaves
 * no trace, and that a race for the last ticket produces exactly one order.
 */

const NOW = new Date('2026-09-20T10:00:00Z');

describe('ordersService.createOrder (Postgres)', () => {
  let eventId: string;
  let slug: string;
  const svc = createOrdersService({
    orders: ordersRepository,
    events: eventsRepository,
    ticketTypes: ticketTypesRepository,
    inventory: createInventoryService(inventoryRepository),
    runInTransaction: (fn) => db.transaction(fn),
    now: () => NOW,
  });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    eventId = randomUUID();
    slug = `orders-${eventId}`;
    await db.insert(schema.events).values({
      id: eventId,
      slug,
      title: 'Orders Test Event',
      startsAt: new Date('2026-10-01T13:00:00Z'),
      registrationOpensAt: new Date('2026-09-11T13:00:00Z'),
      registrationClosesAt: new Date('2026-09-26T13:00:00Z'),
      status: 'published',
    });
  });

  afterAll(async () => {
    // orders reference events/ticket_types without cascade: clear them first.
    await db.delete(schema.orders).where(eq(schema.orders.eventId, eventId));
    await db.delete(schema.events).where(eq(schema.events.id, eventId));
    await queryClient.end();
  });

  async function newTicketType(quantityTotal: number) {
    const id = randomUUID();
    await db.insert(schema.ticketTypes).values({
      id,
      eventId,
      name: 'General',
      pricePaisa: 120_000,
      quantityTotal,
    });
    return id;
  }

  const input = (ticketTypeId: string, quantity: number): CreateOrderInput => ({
    eventSlug: slug,
    ticketTypeId,
    quantity,
    buyerName: 'Nusrat Jahan',
    buyerEmail: 'nusrat@example.com',
    buyerPhone: '+8801712345678',
    attendeeNames: Array.from({ length: quantity }, (_, i) => `Guest ${i + 1}`),
  });

  it('commits the hold, the order and the audit row together', async () => {
    const tt = await newTicketType(10);
    const order = await svc.createOrder(input(tt, 3));

    expect(order.status).toBe('pending_payment');
    expect(order.totalPaisa).toBe(360_000);
    expect(order.attendeeNames).toEqual(['Guest 1', 'Guest 2', 'Guest 3']);
    expect(order.holdExpiresAt?.toISOString()).toBe('2026-09-21T10:00:00.000Z');

    const [row] = await db.select().from(schema.ticketTypes).where(eq(schema.ticketTypes.id, tt));
    expect(row?.quantityReserved).toBe(3);

    const events = await ordersRepository.listEvents(order.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actor: 'buyer',
      action: 'order.created',
      toStatus: 'pending_payment',
    });
  });

  it('a sold-out attempt writes nothing — no order, no audit row, no hold', async () => {
    const tt = await newTicketType(2);
    await expect(svc.createOrder(input(tt, 3))).rejects.toBeInstanceOf(SoldOutError);

    const orders = await db.select().from(schema.orders).where(eq(schema.orders.ticketTypeId, tt));
    expect(orders).toHaveLength(0);
    const [row] = await db.select().from(schema.ticketTypes).where(eq(schema.ticketTypes.id, tt));
    expect(row?.quantityReserved).toBe(0);
  });

  // The UNIQUE constraint name is what turns a collision into a retry; a
  // renamed constraint would silently downgrade it to a generic failure.
  it('maps a duplicate reference from Postgres to OrderReferenceCollisionError and holds nothing', async () => {
    const tt = await newTicketType(5);
    const fixed = createOrdersService({
      orders: ordersRepository,
      events: eventsRepository,
      ticketTypes: ticketTypesRepository,
      inventory: createInventoryService(inventoryRepository),
      runInTransaction: (fn) => db.transaction(fn),
      now: () => NOW,
      reference: () =>
        `EA-${tt
          .slice(0, 6)
          .toUpperCase()
          .replace(/[^A-Z2-9]/g, 'X')}`,
    });
    await fixed.createOrder(input(tt, 1));
    await expect(fixed.createOrder(input(tt, 1))).rejects.toBeInstanceOf(
      OrderReferenceCollisionError,
    );
    const [row] = await db.select().from(schema.ticketTypes).where(eq(schema.ticketTypes.id, tt));
    expect(row?.quantityReserved).toBe(1);
  });

  it('a race for the last ticket produces exactly one order', async () => {
    const tt = await newTicketType(1);
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => svc.createOrder(input(tt, 1))),
    );
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(11);
    for (const r of lost) expect(r.reason).toBeInstanceOf(SoldOutError);

    const orders = await db.select().from(schema.orders).where(eq(schema.orders.ticketTypeId, tt));
    expect(orders).toHaveLength(1);
    const [row] = await db.select().from(schema.ticketTypes).where(eq(schema.ticketTypes.id, tt));
    expect(row?.quantityReserved).toBe(1);
  });
});
