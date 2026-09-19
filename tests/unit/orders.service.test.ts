import { describe, expect, it, vi } from 'vitest';
import {
  AttendeeNamesMismatchError,
  EventNotFoundError,
  InventoryStateError,
  OrderNotFoundError,
  OrderReferenceCollisionError,
  OrderStatusConflictError,
  RegistrationClosedError,
  SoldOutError,
  TicketTypeNotFoundError,
  TrxIdAlreadyUsedError,
} from '@/server/lib/errors';
import { createInventoryService } from '@/server/services/inventory.service';
import { type CreateOrderInput, createOrdersService } from '@/server/services/orders.service';
import { NOW, event, fakeDb, ticketType } from './helpers/fake-db';

function build(
  db: ReturnType<typeof fakeDb>,
  over: { reference?: () => string; now?: () => Date } = {},
) {
  return createOrdersService({
    orders: db.orders,
    tickets: db.tickets,
    events: db.events,
    ticketTypes: db.ticketTypes,
    inventory: createInventoryService(db.inventoryRepo),
    runInTransaction: db.runInTransaction,
    now: over.now ?? (() => NOW),
    reference: over.reference,
  });
}

const input: CreateOrderInput = {
  eventSlug: 'live-dhaka',
  ticketTypeId: 'tt-1',
  quantity: 3,
  buyerName: 'Nusrat Jahan',
  buyerEmail: 'nusrat@example.com',
  buyerPhone: '+8801712345678',
  attendeeNames: ['Nusrat Jahan', 'Tanvir Alam', 'Farhana Rahman'],
};

describe('ordersService.createOrder', () => {
  it('holds inventory, inserts the order and the audit row in one transaction', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
    const svc = build(db, { reference: () => 'EA-TEST01' });

    const order = await svc.createOrder(input);

    expect(order).toMatchObject({
      reference: 'EA-TEST01',
      status: 'pending_payment',
      quantity: 3,
      unitPricePaisa: 120_000,
      subtotalPaisa: 360_000,
      discountPaisa: 0,
      totalPaisa: 360_000,
      buyerEmail: 'nusrat@example.com',
      attendeeNames: input.attendeeNames,
    });
    expect(order.holdExpiresAt?.toISOString()).toBe('2026-09-21T10:00:00.000Z'); // +24h
    expect(db.state.types.get('tt-1')?.quantityReserved).toBe(3);
    expect(db.state.events).toHaveLength(1);
    expect(db.state.events[0]).toMatchObject({
      orderId: order.id,
      actor: 'buyer',
      action: 'order.created',
      fromStatus: null,
      toStatus: 'pending_payment',
    });
    expect(db.txCalls).toEqual({ started: 1, committed: 1, rolledBack: 0 });
  });

  // Invariant 5: nothing client-shaped can influence money.
  it('prices from the ticket type row, ignoring anything extra on the input', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType({ pricePaisa: 5_000 })] });
    const svc = build(db);
    const poisoned = {
      ...input,
      quantity: 2,
      attendeeNames: ['A B', 'C D'],
      unitPricePaisa: 1,
      totalPaisa: 1,
      discountPaisa: 9_999,
    } as CreateOrderInput;
    const order = await svc.createOrder(poisoned);
    expect(order).toMatchObject({
      unitPricePaisa: 5_000,
      subtotalPaisa: 10_000,
      totalPaisa: 10_000,
    });
  });

  it('sold out: throws inside the transaction so nothing is written', async () => {
    const db = fakeDb({
      events: [event()],
      ticketTypes: [ticketType({ quantityTotal: 5, quantitySold: 3 })],
    });
    const svc = build(db);

    await expect(svc.createOrder(input)).rejects.toBeInstanceOf(SoldOutError);
    expect(db.state.orders).toHaveLength(0);
    expect(db.state.events).toHaveLength(0);
    expect(db.state.types.get('tt-1')?.quantityReserved).toBe(0);
    expect(db.txCalls).toEqual({ started: 1, committed: 0, rolledBack: 1 });
  });

  it('retries a reference collision with a fresh reference, then gives up', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
    db.takenRefs.add('EA-DUP001');
    const refs = ['EA-DUP001', 'EA-DUP001', 'EA-FRESH1'];
    let i = 0;
    const svc = build(db, { reference: () => refs[i++]! });

    const order = await svc.createOrder(input);
    expect(order.reference).toBe('EA-FRESH1');
    // Each collision rolled back — including its hold — before the retry.
    expect(db.txCalls).toEqual({ started: 3, committed: 1, rolledBack: 2 });
    expect(db.state.types.get('tt-1')?.quantityReserved).toBe(3);

    const stuck = build(db, { reference: () => 'EA-DUP001' });
    await expect(stuck.createOrder(input)).rejects.toBeInstanceOf(OrderReferenceCollisionError);
  });

  it('refuses when the event is missing, a draft, or outside its window', async () => {
    const draft = fakeDb({ events: [event({ status: 'draft' })], ticketTypes: [ticketType()] });
    await expect(build(draft).createOrder(input)).rejects.toBeInstanceOf(EventNotFoundError);

    const unknown = fakeDb({ events: [], ticketTypes: [ticketType()] });
    await expect(build(unknown).createOrder(input)).rejects.toBeInstanceOf(EventNotFoundError);

    const notOpen = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
    const early = build(notOpen, { now: () => new Date('2026-09-01T00:00:00Z') });
    await expect(early.createOrder(input)).rejects.toMatchObject({
      name: 'RegistrationClosedError',
      phase: 'not_open',
    });
    const late = build(notOpen, { now: () => new Date('2026-09-27T00:00:00Z') });
    await expect(late.createOrder(input)).rejects.toBeInstanceOf(RegistrationClosedError);
    expect(notOpen.txCalls.started).toBe(0);
  });

  it("refuses another event's ticket type and one outside its sales window", async () => {
    const other = fakeDb({
      events: [event()],
      ticketTypes: [ticketType({ eventId: 'ev-other' })],
    });
    await expect(build(other).createOrder(input)).rejects.toBeInstanceOf(TicketTypeNotFoundError);

    const ended = fakeDb({
      events: [event()],
      ticketTypes: [ticketType({ salesEndsAt: new Date('2026-09-19T00:00:00Z') })],
    });
    await expect(build(ended).createOrder(input)).rejects.toMatchObject({
      name: 'TicketTypeNotOnSaleError',
      state: 'window_ended',
    });
    expect(ended.txCalls.started).toBe(0);
  });

  // The most common real race: single ticket type, last ticket gone. The
  // buyer must be told "sold out" (and which type), not "registration closed".
  it('an event-wide sold-out snapshot reports SoldOutError, not RegistrationClosedError', async () => {
    const db = fakeDb({
      events: [event()],
      ticketTypes: [ticketType({ quantityTotal: 1, quantitySold: 1 })],
    });
    const err = await build(db)
      .createOrder({ ...input, quantity: 1, attendeeNames: ['A B'] })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(SoldOutError);
    expect((err as SoldOutError).ticketTypeId).toBe('tt-1');
  });

  it('refuses a names/quantity mismatch before opening a transaction', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
    await expect(
      build(db).createOrder({ ...input, attendeeNames: ['Only One'] }),
    ).rejects.toBeInstanceOf(AttendeeNamesMismatchError);
    expect(db.txCalls.started).toBe(0);
  });

  it('a ticket type that is sold out by the snapshot still goes through the atomic hold', async () => {
    // Snapshot says 0 left → the hold is the authority; it answers sold out.
    const db = fakeDb({
      events: [event()],
      ticketTypes: [
        ticketType({ quantityTotal: 3, quantitySold: 3 }),
        ticketType({ id: 'tt-2', quantityTotal: 50 }),
      ],
    });
    await expect(build(db).createOrder(input)).rejects.toBeInstanceOf(SoldOutError);
    expect(db.inventoryRepo.reserve).toHaveBeenCalledTimes(1);
  });
});

describe('ordersService.getOrder', () => {
  it('returns order + event + ticket type, and 404s an unknown id', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
    const svc = build(db);
    const created = await svc.createOrder(input);
    const view = await svc.getOrder(created.id);
    expect(view.order.id).toBe(created.id);
    expect(view.event.slug).toBe('live-dhaka');
    expect(view.ticketType.name).toBe('General');
    await expect(svc.getOrder('nope')).rejects.toBeInstanceOf(OrderNotFoundError);
  });
});

describe('ordersService.submitPayment', () => {
  const payment = { trxId: '9AB12CD34E', senderMsisdn: '+8801712345678' };

  it('first submission moves pending_payment → pending_verification with an audit row', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
    const svc = build(db);
    const order = await svc.createOrder(input);

    const updated = await svc.submitPayment(order.id, payment);

    expect(updated).toMatchObject({
      status: 'pending_verification',
      bkashTrxId: '9AB12CD34E',
      bkashSenderMsisdn: '+8801712345678',
    });
    const audit = db.state.events.filter((e) => e.orderId === order.id);
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({
      actor: 'buyer',
      action: 'payment.submitted',
      fromStatus: 'pending_payment',
      toStatus: 'pending_verification',
    });
  });

  it('normalises the trxID itself, whoever the caller is (Invariant 3)', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
    const svc = build(db);
    const order = await svc.createOrder(input);
    const updated = await svc.submitPayment(order.id, { ...payment, trxId: '  9ab12cd34e ' });
    expect(updated.bkashTrxId).toBe('9AB12CD34E');
  });

  it('a later submission corrects the trxID without changing status', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
    const svc = build(db);
    const order = await svc.createOrder(input);
    await svc.submitPayment(order.id, payment);

    const updated = await svc.submitPayment(order.id, { ...payment, trxId: 'ZZ99ZZ99ZZ' });
    expect(updated).toMatchObject({ status: 'pending_verification', bkashTrxId: 'ZZ99ZZ99ZZ' });
    const last = db.state.events.at(-1);
    expect(last).toMatchObject({ action: 'payment.updated', fromStatus: 'pending_verification' });
  });

  // Invariant 3: the same trxID can never pay for two orders. The error
  // comes from the repository (the UNIQUE index in production) and the
  // audit row must roll back with it.
  it('a trxID already on another order is refused and nothing is written', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType({ quantityTotal: 50 })] });
    const svc = build(db);
    const a = await svc.createOrder(input);
    const b = await svc.createOrder({ ...input, buyerEmail: 'other@example.com' });
    await svc.submitPayment(a.id, payment);

    const before = db.state.events.length;
    await expect(svc.submitPayment(b.id, payment)).rejects.toBeInstanceOf(TrxIdAlreadyUsedError);
    expect(db.state.events).toHaveLength(before);
    expect(db.state.orders.find((o) => o.id === b.id)?.status).toBe('pending_payment');
  });

  it('refuses when the order is not awaiting or checking payment, writing nothing', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
    const svc = build(db);
    const order = await svc.createOrder(input);
    const row = db.state.orders.find((o) => o.id === order.id)!;
    row.status = 'expired';
    const events = db.state.events.length;
    const err = await svc.submitPayment(order.id, payment).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OrderStatusConflictError);
    expect((err as OrderStatusConflictError).status).toBe('expired'); // the real state, for the banner
    expect(db.state.events).toHaveLength(events);
    expect(db.state.orders.find((o) => o.id === order.id)?.bkashTrxId).toBeNull();
    await expect(svc.submitPayment('nope', payment)).rejects.toBeInstanceOf(OrderNotFoundError);
  });
});

describe('ordersService.expireLapsedHolds', () => {
  const later = new Date(NOW.getTime() + 25 * 3_600_000); // hold is 24h

  it('expires only lapsed pending_payment orders, releasing stock and auditing each', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType({ quantityTotal: 50 })] });
    const svc = build(db);
    const lapsed = await svc.createOrder(input); // 3 tickets
    const submitted = await svc.createOrder({ ...input, quantity: 1, attendeeNames: ['A B'] });
    await svc.submitPayment(submitted.id, { trxId: '9AB12CD34E', senderMsisdn: '+8801712345678' });
    expect(db.state.types.get('tt-1')?.quantityReserved).toBe(4);

    const result = await svc.expireLapsedHolds(later);

    expect(result).toEqual({ expired: 1, failed: 0 });
    expect(db.state.orders.find((o) => o.id === lapsed.id)?.status).toBe('expired');
    expect(db.state.orders.find((o) => o.id === submitted.id)?.status).toBe('pending_verification');
    expect(db.state.types.get('tt-1')?.quantityReserved).toBe(1);
    expect(db.state.events.at(-1)).toMatchObject({
      orderId: lapsed.id,
      actor: 'system',
      action: 'order.expired',
      fromStatus: 'pending_payment',
      toStatus: 'expired',
    });

    // Idempotent: a second run finds nothing and releases nothing.
    expect(await svc.expireLapsedHolds(later)).toEqual({ expired: 0, failed: 0 });
    expect(db.state.types.get('tt-1')?.quantityReserved).toBe(1);
  });

  // One corrupted order must never freeze every hold behind it.
  it('skips an order whose release fails, expires the rest, and reports the failure', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType({ quantityTotal: 50 })] });
    const svc = build(db);
    const bad = await svc.createOrder(input);
    const good = await svc.createOrder({ ...input, quantity: 2, attendeeNames: ['A B', 'C D'] });
    const release = db.inventoryRepo.release as ReturnType<typeof vi.fn>;
    release.mockImplementationOnce(async (id: string) => {
      throw new InventoryStateError(id, 'release');
    });

    expect(await svc.expireLapsedHolds(later)).toEqual({ expired: 1, failed: 1 });
    expect(db.state.orders.find((o) => o.id === bad.id)?.status).toBe('pending_payment');
    expect(db.state.orders.find((o) => o.id === good.id)?.status).toBe('expired');
    expect(db.state.types.get('tt-1')?.quantityReserved).toBe(3); // bad's hold untouched
  });

  it('does nothing before the hold lapses', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
    const svc = build(db);
    await svc.createOrder(input);
    const started = db.txCalls.started;
    expect(await svc.expireLapsedHolds(new Date(NOW.getTime() + 3_600_000))).toEqual({
      expired: 0,
      failed: 0,
    });
    expect(db.txCalls.started).toBe(started);
  });

  // The race the conditional UPDATE exists for: a buyer submits between the
  // job's SELECT and its UPDATE. The flip fails, so the hold is NOT released.
  it('skips a hold that was submitted between the scan and the flip, without releasing it', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
    const svc = build(db);
    const order = await svc.createOrder(input);
    const original = db.orders.listLapsedHolds;
    db.orders.listLapsedHolds = async (at, limit) => {
      const rows = await original(at, limit);
      // Buyer wins the race right after the scan.
      await svc.submitPayment(order.id, { trxId: '9AB12CD34E', senderMsisdn: '+8801712345678' });
      return rows;
    };

    expect(await svc.expireLapsedHolds(later)).toEqual({ expired: 0, failed: 0 });
    expect(db.inventoryRepo.release).not.toHaveBeenCalled();
    expect(db.state.orders.find((o) => o.id === order.id)?.status).toBe('pending_verification');
  });
});
