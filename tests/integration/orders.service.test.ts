import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import {
  HoldLapsedError,
  OrderReferenceCollisionError,
  SoldOutError,
  TrxIdAlreadyUsedError,
} from '@/server/lib/errors';
import { HOLD_GRACE_MINUTES, HOLD_MINUTES, lapsedBefore } from '@/server/lib/hold';
import { isCheckViolation } from '@/server/lib/pg-errors';
import { eventsRepository } from '@/server/repositories/events.repository';
import { inventoryRepository } from '@/server/repositories/inventory.repository';
import { ordersRepository } from '@/server/repositories/orders.repository';
import { ticketTypesRepository } from '@/server/repositories/ticket-types.repository';
import { ticketsRepository } from '@/server/repositories/tickets.repository';
import { createInventoryService } from '@/server/services/inventory.service';
import { type CreateOrderInput, createOrdersService } from '@/server/services/orders.service';

/**
 * Order creation against real Postgres, wired exactly like the container.
 * Proves the three writes commit together, that a sold-out attempt leaves
 * no trace, and that a race for the last ticket produces exactly one order.
 */

const NOW = new Date('2026-09-20T10:00:00Z');
const MINUTE = 60_000;
/** NOW + m minutes (+ extra ms). */
const plus = (m: number, ms = 0) => new Date(NOW.getTime() + m * MINUTE + ms);
/** The cutoff of an order placed at NOW: the 20-minute hold plus the grace (ADR-054). */
const CUTOFF_MIN = HOLD_MINUTES + HOLD_GRACE_MINUTES;

describe('ordersService.createOrder (Postgres)', () => {
  let eventId: string;
  let slug: string;
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
    // A different buyer each time: one phone may hold only
    // MAX_OPEN_ORDERS_PER_BUYER open orders per event (orders.buyer-cap.test.ts).
    buyerPhone: `+88017${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    attendeeNames: Array.from({ length: quantity }, (_, i) => `Guest ${i + 1}`),
  });

  it('commits the hold, the order and the audit row together', async () => {
    const tt = await newTicketType(10);
    const order = await svc.createOrder(input(tt, 3));

    expect(order.status).toBe('pending_payment');
    expect(order.totalPaisa).toBe(360_000);
    expect(order.attendeeNames).toEqual(['Guest 1', 'Guest 2', 'Guest 3']);
    expect(order.holdExpiresAt?.toISOString()).toBe('2026-09-20T10:20:00.000Z'); // +20 min (ADR-054)

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
      tickets: ticketsRepository,
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

  // Invariant 3: enforced by the UNIQUE index, surfaced as a typed error,
  // and the audit row rolls back with the refused write.
  it('the same trxID cannot pay for two orders (real UNIQUE index)', async () => {
    const tt = await newTicketType(10);
    const a = await svc.createOrder(input(tt, 1));
    const b = await svc.createOrder(input(tt, 1));
    const payment = { trxId: 'TRX' + tt.slice(0, 7).toUpperCase(), senderMsisdn: '+8801712345678' };

    const paidA = await svc.submitPayment(a.id, payment);
    expect(paidA.status).toBe('pending_verification');
    expect(paidA.bkashTrxId).toBe(payment.trxId);

    await expect(svc.submitPayment(b.id, payment)).rejects.toBeInstanceOf(TrxIdAlreadyUsedError);
    const [rowB] = await db.select().from(schema.orders).where(eq(schema.orders.id, b.id));
    expect(rowB).toMatchObject({ status: 'pending_payment', bkashTrxId: null });
    expect(await ordersRepository.listEvents(b.id)).toHaveLength(1); // only order.created
  });

  // PHASE 3 EXIT: an order holds inventory and expires correctly.
  it('expires lapsed pending_payment holds, releases their stock, and leaves submitted orders alone', async () => {
    const tt = await newTicketType(10);
    const lapsed = await svc.createOrder(input(tt, 3));
    const submitted = await svc.createOrder(input(tt, 2));
    await svc.submitPayment(submitted.id, {
      trxId: 'EXP' + tt.slice(0, 7).toUpperCase(),
      senderMsisdn: '+8801712345678',
    });
    const counters = async () =>
      (await db.select().from(schema.ticketTypes).where(eq(schema.ticketTypes.id, tt)))[0]!;
    expect((await counters()).quantityReserved).toBe(5);

    // Not yet: the buyer's clock hit zero at +20 min, but the grace runs to +22.
    for (const at of [plus(HOLD_MINUTES), plus(CUTOFF_MIN, -1_000)]) {
      await svc.expireLapsedHolds(at);
      expect((await counters()).quantityReserved).toBe(5);
    }

    // Past the cutoff: the unsubmitted hold goes, the submitted one waits for a person.
    const later = plus(CUTOFF_MIN, 1);
    // The job expires every lapsed hold in the database, and other files'
    // orders share it (the promo suite leaves one at this clock) — so the
    // bound is every lapsed pending hold, not only this event's.
    const before = (
      await db.select().from(schema.orders).where(eq(schema.orders.status, 'pending_payment'))
    ).filter((o) => o.holdExpiresAt && o.holdExpiresAt < lapsedBefore(later)).length;
    const result = await svc.expireLapsedHolds(later);
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(result.expired).toBeLessThanOrEqual(before);

    const [rowLapsed] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, lapsed.id));
    const [rowSubmitted] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, submitted.id));
    expect(rowLapsed?.status).toBe('expired');
    expect(rowSubmitted?.status).toBe('pending_verification');
    expect((await counters()).quantityReserved).toBe(2);
    expect((await ordersRepository.listEvents(lapsed.id)).at(-1)).toMatchObject({
      actor: 'system',
      action: 'order.expired',
      toStatus: 'expired',
      note: `${HOLD_MINUTES}-minute hold lapsed; 3 released`,
    });

    // Idempotent for our rows: nothing more to release.
    await svc.expireLapsedHolds(later);
    expect((await counters()).quantityReserved).toBe(2);

    // An expired order can no longer take a payment.
    await expect(
      svc.submitPayment(lapsed.id, { trxId: 'LATE000000', senderMsisdn: '+8801712345678' }),
    ).rejects.toMatchObject({ name: 'OrderStatusConflictError' });
  });

  // The promise ADR-013 makes: two workers (or a re-run racing a run) can
  // never release the same hold twice. Rests on Postgres row locking, so
  // it is proven here, not in the unit suite.
  it('two concurrent expiry runs release each lapsed hold exactly once', async () => {
    const tt = await newTicketType(20);
    const held = await Promise.all([1, 2, 3].map((q) => svc.createOrder(input(tt, q))));
    const later = plus(CUTOFF_MIN, 1);

    await Promise.all([svc.expireLapsedHolds(later), svc.expireLapsedHolds(later)]);

    const [row] = await db.select().from(schema.ticketTypes).where(eq(schema.ticketTypes.id, tt));
    expect(row?.quantityReserved).toBe(0);
    for (const o of held) {
      const evs = await ordersRepository.listEvents(o.id);
      expect(evs.filter((e) => e.action === 'order.expired')).toHaveLength(1);
    }
  });

  // ADR-054 against Postgres: a trxID is taken in the unannounced grace and
  // refused at the cutoff, under the row lock, before the job has run.
  it('takes a trxID inside the grace, refuses one at the cutoff and writes nothing', async () => {
    const tt = await newTicketType(10);
    const early = await svc.createOrder(input(tt, 1));
    const late = await svc.createOrder(input(tt, 2));
    const at = (when: Date) =>
      createOrdersService({
        orders: ordersRepository,
        tickets: ticketsRepository,
        events: eventsRepository,
        ticketTypes: ticketTypesRepository,
        inventory: createInventoryService(inventoryRepository),
        runInTransaction: (fn) => db.transaction(fn),
        now: () => when,
      });
    const trx = (p: string) => ({
      trxId: p + tt.slice(0, 7).toUpperCase(),
      senderMsisdn: '+8801712345678',
    });

    await expect(
      at(plus(HOLD_MINUTES + 1)).submitPayment(early.id, trx('GRC')),
    ).resolves.toMatchObject({ status: 'pending_verification' });

    await expect(at(plus(CUTOFF_MIN)).submitPayment(late.id, trx('LAT'))).rejects.toBeInstanceOf(
      HoldLapsedError,
    );
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, late.id));
    expect(row).toMatchObject({ status: 'pending_payment', bkashTrxId: null });
    expect(await ordersRepository.listEvents(late.id)).toHaveLength(1); // only order.created
    const [counter] = await db
      .select()
      .from(schema.ticketTypes)
      .where(eq(schema.ticketTypes.id, tt));
    expect(counter?.quantityReserved).toBe(3);

    // ADR-012: the submitted order never lapses; a correction is still taken.
    await expect(
      at(plus(CUTOFF_MIN + 60)).submitPayment(early.id, trx('FIX')),
    ).resolves.toMatchObject({ status: 'pending_verification', bkashTrxId: trx('FIX').trxId });
  });

  // The CHECK behind Invariant 3: a raw write of an un-normalised trxID is refused.
  it('Postgres refuses a trxID that is not upper-cased and trimmed', async () => {
    const tt = await newTicketType(5);
    const order = await svc.createOrder(input(tt, 1));
    const raw = db
      .update(schema.orders)
      .set({ bkashTrxId: 'lower12345' })
      .where(eq(schema.orders.id, order.id));
    const err = await raw.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isCheckViolation(err, 'orders_bkash_trx_id_normalised')).toBe(true);
  });
});
