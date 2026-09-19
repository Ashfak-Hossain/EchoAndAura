import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import { OrderStatusConflictError, TrxIdChangedError } from '@/server/lib/errors';
import { eventsRepository } from '@/server/repositories/events.repository';
import { inventoryRepository } from '@/server/repositories/inventory.repository';
import { ordersRepository } from '@/server/repositories/orders.repository';
import { ticketTypesRepository } from '@/server/repositories/ticket-types.repository';
import { ticketsRepository } from '@/server/repositories/tickets.repository';
import { createFulfilmentService } from '@/server/services/fulfilment.service';
import { createInventoryService } from '@/server/services/inventory.service';
import { createOrdersService } from '@/server/services/orders.service';

/**
 * Invariant 4 against real Postgres: approve moves held → sold and creates
 * the ticket rows atomically, reject releases, and two admins approving the
 * same order at once produce exactly one set of tickets.
 */

const NOW = new Date('2026-09-20T10:00:00Z');
const ACTOR = 'raj@example.com';

describe('fulfilmentService (Postgres)', () => {
  let eventId: string;
  let slug: string;
  const inventory = createInventoryService(inventoryRepository);
  const orders = createOrdersService({
    orders: ordersRepository,
    tickets: ticketsRepository,
    events: eventsRepository,
    ticketTypes: ticketTypesRepository,
    inventory,
    runInTransaction: (fn) => db.transaction(fn),
    now: () => NOW,
  });
  const onTicketsIssued = vi.fn(async () => {});
  const fulfilment = createFulfilmentService({
    orders: ordersRepository,
    tickets: ticketsRepository,
    inventory,
    runInTransaction: (fn) => db.transaction(fn),
    onTicketsIssued,
  });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    eventId = randomUUID();
    slug = `fulfil-${eventId}`;
    await db.insert(schema.events).values({
      id: eventId,
      slug,
      title: 'Fulfilment Test Event',
      startsAt: new Date('2026-10-01T13:00:00Z'),
      registrationOpensAt: new Date('2026-09-11T13:00:00Z'),
      registrationClosesAt: new Date('2026-09-26T13:00:00Z'),
      status: 'published',
    });
  });

  afterAll(async () => {
    await db.delete(schema.tickets).where(eq(schema.tickets.eventId, eventId));
    await db.delete(schema.orders).where(eq(schema.orders.eventId, eventId));
    await db.delete(schema.events).where(eq(schema.events.id, eventId));
    await queryClient.end();
  });

  async function pendingOrder(quantity: number) {
    const tt = randomUUID();
    await db.insert(schema.ticketTypes).values({
      id: tt,
      eventId,
      name: 'General',
      pricePaisa: 120_000,
      quantityTotal: 10,
    });
    const order = await orders.createOrder({
      eventSlug: slug,
      ticketTypeId: tt,
      quantity,
      buyerName: 'Nusrat Jahan',
      buyerEmail: 'nusrat@example.com',
      buyerPhone: '+8801712345678',
      attendeeNames: Array.from({ length: quantity }, (_, i) => `Guest ${i + 1}`),
    });
    const trxId = `F${tt.replace(/-/g, '').slice(0, 9).toUpperCase()}`;
    await orders.submitPayment(order.id, { trxId, senderMsisdn: '+8801712345678' });
    return { tt, order, trxId };
  }

  const counters = async (tt: string) =>
    (await db.select().from(schema.ticketTypes).where(eq(schema.ticketTypes.id, tt)))[0]!;

  it('approve: held → sold, N unique tickets with the attendee names, order issued, hook after commit', async () => {
    const { tt, order, trxId } = await pendingOrder(3);
    expect(await counters(tt)).toMatchObject({ quantitySold: 0, quantityReserved: 3 });

    const result = await fulfilment.approveOrder(order.id, { actor: ACTOR, verifiedTrxId: trxId });

    expect(result.order.status).toBe('issued');
    expect(await counters(tt)).toMatchObject({ quantitySold: 3, quantityReserved: 0 });
    const rows = await ticketsRepository.listByOrder(order.id);
    expect(rows.map((t) => t.attendeeName).sort()).toEqual(['Guest 1', 'Guest 2', 'Guest 3']);
    expect(new Set(rows.map((t) => t.code)).size).toBe(3);
    const actions = (await ordersRepository.listEvents(order.id)).map((e) => e.action);
    expect(actions).toEqual([
      'order.created',
      'payment.submitted',
      'payment.approved',
      'tickets.issued',
    ]);
    expect(onTicketsIssued).toHaveBeenCalledWith(order.id);
  });

  it('reject: released, reason and note stored, nothing sold, no tickets', async () => {
    const { tt, order, trxId } = await pendingOrder(2);
    const rejected = await fulfilment.rejectOrder(order.id, {
      actor: ACTOR,
      reason: 'amount_mismatch',
      note: 'You sent ৳2,000.00; the order is ৳2,400.00.',
    });
    expect(rejected).toMatchObject({
      status: 'rejected',
      rejectionReason: 'amount_mismatch',
      rejectionNote: 'You sent ৳2,000.00; the order is ৳2,400.00.',
    });
    expect(await counters(tt)).toMatchObject({ quantitySold: 0, quantityReserved: 0 });
    expect(await ticketsRepository.listByOrder(order.id)).toHaveLength(0);
    await expect(
      fulfilment.approveOrder(order.id, { actor: ACTOR, verifiedTrxId: trxId }),
    ).rejects.toBeInstanceOf(OrderStatusConflictError);
  });

  // Invariant 4 under a race: two admin tabs, one Approve each.
  it('two concurrent approves of one order issue exactly one set of tickets', async () => {
    const { tt, order, trxId } = await pendingOrder(4);
    const results = await Promise.allSettled([
      fulfilment.approveOrder(order.id, { actor: 'a@example.com', verifiedTrxId: trxId }),
      fulfilment.approveOrder(order.id, { actor: 'b@example.com', verifiedTrxId: trxId }),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0]?.reason).toBeInstanceOf(OrderStatusConflictError);

    expect(await counters(tt)).toMatchObject({ quantitySold: 4, quantityReserved: 0 });
    expect(await ticketsRepository.listByOrder(order.id)).toHaveLength(4);
    const issued = (await ordersRepository.listEvents(order.id)).filter(
      (e) => e.action === 'tickets.issued',
    );
    expect(issued).toHaveLength(1);
  });

  // Two tabs, two different buttons: exactly one of {tickets, release} happens.
  it('approve racing reject: exactly one wins, counters agree with the winner', async () => {
    const { tt, order, trxId } = await pendingOrder(2);
    const results = await Promise.allSettled([
      fulfilment.approveOrder(order.id, { actor: 'a@example.com', verifiedTrxId: trxId }),
      fulfilment.rejectOrder(order.id, { actor: 'b@example.com', reason: 'duplicate_order' }),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    expect(won).toHaveLength(1);
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id));
    const c = await counters(tt);
    if (row?.status === 'issued') {
      expect(c).toMatchObject({ quantitySold: 2, quantityReserved: 0 });
      expect(await ticketsRepository.listByOrder(order.id)).toHaveLength(2);
    } else {
      expect(row?.status).toBe('rejected');
      expect(c).toMatchObject({ quantitySold: 0, quantityReserved: 0 });
      expect(await ticketsRepository.listByOrder(order.id)).toHaveLength(0);
    }
  });

  // The buyer edits the trxID while the admin is approving the old one.
  it('approve racing a buyer edit never issues against an unverified trxID', async () => {
    const { tt, order, trxId } = await pendingOrder(1);
    const results = await Promise.allSettled([
      fulfilment.approveOrder(order.id, { actor: ACTOR, verifiedTrxId: trxId }),
      orders.submitPayment(order.id, {
        trxId: `${trxId.slice(0, 9)}Z`,
        senderMsisdn: '+8801712345678',
      }),
    ]);
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id));
    const approve = results[0]!;
    if (approve.status === 'fulfilled') {
      // Approve locked first: issued against the verified id; the edit was refused.
      expect(row).toMatchObject({ status: 'issued', bkashTrxId: trxId });
      expect(results[1]?.status).toBe('rejected');
    } else {
      // Edit locked first: approve saw a different id and refused.
      expect(approve.reason).toBeInstanceOf(TrxIdChangedError);
      expect(row?.status).toBe('pending_verification');
      expect(await ticketsRepository.listByOrder(order.id)).toHaveLength(0);
      expect(await counters(tt)).toMatchObject({ quantitySold: 0, quantityReserved: 1 });
    }
  });
});
