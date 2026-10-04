import { describe, expect, it, vi } from 'vitest';
import {
  AttendeeNamesMismatchError,
  EventNotFoundError,
  HoldLapsedError,
  InventoryStateError,
  OrderNotFoundError,
  OrderReferenceCollisionError,
  OrderStatusConflictError,
  RegistrationClosedError,
  SoldOutError,
  TicketTypeNotFoundError,
  TooManyOpenOrdersError,
  TrxIdAlreadyUsedError,
} from '@/server/lib/errors';
import type { DbExecutor } from '@/db/executor';
import { HOLD_GRACE_MINUTES, HOLD_MINUTES } from '@/server/lib/hold';
import { createInventoryService } from '@/server/services/inventory.service';
import {
  type CreateOrderInput,
  createOrdersService,
  MAX_OPEN_ORDERS_PER_BUYER,
} from '@/server/services/orders.service';
import { NOW, event, fakeDb, ticketType } from './helpers/fake-db';

function build(
  db: ReturnType<typeof fakeDb>,
  over: {
    reference?: () => string;
    now?: () => Date;
    runInTransaction?: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  } = {},
) {
  return createOrdersService({
    orders: db.orders,
    tickets: db.tickets,
    events: db.events,
    ticketTypes: db.ticketTypes,
    inventory: createInventoryService(db.inventoryRepo),
    runInTransaction: over.runInTransaction ?? db.runInTransaction,
    now: over.now ?? (() => NOW),
    reference: over.reference,
  });
}

const MINUTE = 60_000;
/** NOW + m minutes (+ extra ms): orders in these tests are placed at NOW. */
const plus = (m: number, ms = 0) => new Date(NOW.getTime() + m * MINUTE + ms);
/** The cutoff of an order placed at NOW: the 20-minute hold plus the grace (ADR-054). */
const CUTOFF_MIN = HOLD_MINUTES + HOLD_GRACE_MINUTES;

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
    expect(order.holdExpiresAt?.toISOString()).toBe('2026-09-20T10:20:00.000Z'); // +20 min (ADR-054)
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

// Phase 7.6: a few orders must not be able to hold a whole event, 20 minutes at a time.
describe('ordersService.createOrder: open orders per buyer', () => {
  const one = { ...input, quantity: 1, attendeeNames: ['Nusrat Jahan'] };
  const roomy = () =>
    fakeDb({ events: [event()], ticketTypes: [ticketType({ quantityTotal: 50 })] });

  it(`allows ${MAX_OPEN_ORDERS_PER_BUYER} open orders per phone, refuses the next and holds nothing for it`, async () => {
    const db = roomy();
    const svc = build(db);
    for (let i = 0; i < MAX_OPEN_ORDERS_PER_BUYER; i++) await svc.createOrder(one);

    await expect(svc.createOrder(one)).rejects.toBeInstanceOf(TooManyOpenOrdersError);
    expect(db.state.orders).toHaveLength(MAX_OPEN_ORDERS_PER_BUYER);
    expect(db.state.types.get('tt-1')?.quantityReserved).toBe(MAX_OPEN_ORDERS_PER_BUYER);
    expect(db.state.events).toHaveLength(MAX_OPEN_ORDERS_PER_BUYER);
    expect(db.txCalls.rolledBack).toBe(1);
  });

  it('checks under the buyer lock, inside the transaction, before holding a seat', async () => {
    const db = roomy();
    await build(db).createOrder(one);
    expect(db.orders.lockBuyer).toHaveBeenCalledWith('ev-1', one.buyerPhone, expect.anything());
    const lock = vi.mocked(db.orders.lockBuyer).mock.invocationCallOrder[0]!;
    const count = vi.mocked(db.orders.countOpenForBuyer).mock.invocationCallOrder[0]!;
    const hold = vi.mocked(db.inventoryRepo.reserve).mock.invocationCallOrder[0]!;
    expect(lock).toBeLessThan(count);
    expect(count).toBeLessThan(hold);
  });

  it('counts an order awaiting verification as open', async () => {
    const db = roomy();
    const svc = build(db);
    await svc.createOrder(one);
    await svc.createOrder(one);
    db.state.orders[0]!.status = 'pending_verification';
    await expect(svc.createOrder(one)).rejects.toBeInstanceOf(TooManyOpenOrdersError);
  });

  // ADR-054: lapsed means past the cutoff (the clock plus the grace), not
  // just past the clock the buyer saw — the order can still be paid then.
  it('frees the slot once a hold has lapsed by its cutoff, even before the expiry job runs', async () => {
    const db = roomy();
    const clock = { at: NOW };
    const svc = build(db, { now: () => clock.at });
    await svc.createOrder(one);
    clock.at = plus(10);
    await svc.createOrder(one);

    // The first order's clock hit zero at +20 min, but it is inside the grace: still open.
    clock.at = plus(CUTOFF_MIN, -1);
    await expect(svc.createOrder(one)).rejects.toBeInstanceOf(TooManyOpenOrdersError);
    // At its cutoff it lapses and no longer counts.
    clock.at = plus(CUTOFF_MIN);
    await expect(svc.createOrder(one)).resolves.toMatchObject({ status: 'pending_payment' });
    expect(db.orders.countOpenForBuyer).toHaveBeenLastCalledWith(
      'ev-1',
      one.buyerPhone,
      plus(HOLD_MINUTES),
      expect.anything(),
    );
  });

  it('an order awaiting verification keeps counting long after its hold would have lapsed', async () => {
    const db = roomy();
    const clock = { at: NOW };
    const svc = build(db, { now: () => clock.at });
    await svc.createOrder(one);
    await svc.createOrder(one);
    db.state.orders[0]!.status = 'pending_verification';
    db.state.orders[1]!.status = 'pending_verification';
    clock.at = plus(24 * 60);
    await expect(svc.createOrder(one)).rejects.toBeInstanceOf(TooManyOpenOrdersError);
  });

  it('frees the slot for orders that are paid, issued, rejected, expired or cancelled', async () => {
    const db = roomy();
    const svc = build(db);
    await svc.createOrder(one);
    await svc.createOrder(one);
    db.state.orders[0]!.status = 'issued';
    db.state.orders[1]!.status = 'rejected';
    await svc.createOrder(one);
    await expect(svc.createOrder(one)).resolves.toMatchObject({ status: 'pending_payment' });
  });

  it('never limits a different phone', async () => {
    const db = roomy();
    const svc = build(db);
    await svc.createOrder(one);
    await svc.createOrder(one);
    await expect(svc.createOrder({ ...one, buyerPhone: '+8801812345678' })).resolves.toBeTruthy();
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

// ADR-054: the buyer sees 20 minutes; a trxID is still taken for an
// unannounced 2-minute grace; at the cutoff it is refused, even before the
// expiry job has flipped the order.
describe('ordersService.submitPayment: the hold cutoff', () => {
  const payment = { trxId: '9AB12CD34E', senderMsisdn: '+8801712345678' };

  async function placed() {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
    const clock = { at: NOW };
    const svc = build(db, { now: () => clock.at });
    const order = await svc.createOrder(input);
    return { db, clock, svc, order };
  }

  it('accepts a trxID after the clock hit zero, inside the grace', async () => {
    const { svc, clock, order } = await placed();
    clock.at = plus(HOLD_MINUTES + 1);
    await expect(svc.submitPayment(order.id, payment)).resolves.toMatchObject({
      status: 'pending_verification',
      bkashTrxId: '9AB12CD34E',
    });
  });

  it('accepts one 1 ms before the cutoff', async () => {
    const { svc, clock, order } = await placed();
    clock.at = plus(CUTOFF_MIN, -1);
    await expect(svc.submitPayment(order.id, payment)).resolves.toMatchObject({
      status: 'pending_verification',
    });
  });

  it('refuses one at the cutoff with HoldLapsedError, writing and changing nothing', async () => {
    const { db, svc, clock, order } = await placed();
    clock.at = plus(CUTOFF_MIN);
    const events = db.state.events.length;
    const reserved = db.state.types.get('tt-1')?.quantityReserved;

    const err = await svc.submitPayment(order.id, payment).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(HoldLapsedError);
    expect((err as HoldLapsedError).orderId).toBe(order.id);
    expect(db.state.events).toHaveLength(events); // no audit row
    expect(db.state.orders.find((o) => o.id === order.id)).toMatchObject({
      status: 'pending_payment', // the expiry job flips it, not this
      bkashTrxId: null,
      bkashSenderMsisdn: null,
    });
    expect(db.state.types.get('tt-1')?.quantityReserved).toBe(reserved);
    expect(db.orders.transition).not.toHaveBeenCalled();
  });

  it('still refuses long after the cutoff', async () => {
    const { svc, clock, order } = await placed();
    clock.at = plus(24 * 60);
    await expect(svc.submitPayment(order.id, payment)).rejects.toBeInstanceOf(HoldLapsedError);
  });

  // ADR-012: once a trxID is in, nothing expires — a person decides.
  it('a correction to an order awaiting verification works after the cutoff', async () => {
    const { db, svc, clock, order } = await placed();
    clock.at = plus(5);
    await svc.submitPayment(order.id, payment);
    clock.at = plus(CUTOFF_MIN + 60);
    const updated = await svc.submitPayment(order.id, { ...payment, trxId: 'ZZ99ZZ99ZZ' });
    expect(updated).toMatchObject({ status: 'pending_verification', bkashTrxId: 'ZZ99ZZ99ZZ' });
    expect(db.state.events.at(-1)).toMatchObject({
      action: 'payment.updated',
      fromStatus: 'pending_verification',
    });
  });
});

describe('ordersService.expireLapsedHolds', () => {
  // Strictly past the cutoff of an order placed at NOW (20 min + 2 min grace).
  const later = plus(CUTOFF_MIN, 1);

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

  it('does nothing before the hold lapses: not when the clock hits zero, not in the grace', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
    const svc = build(db);
    const order = await svc.createOrder(input);
    const started = db.txCalls.started;
    for (const at of [plus(1), plus(HOLD_MINUTES), plus(HOLD_MINUTES + 1), plus(21, 59_000)]) {
      expect(await svc.expireLapsedHolds(at)).toEqual({ expired: 0, failed: 0 });
    }
    expect(db.txCalls.started).toBe(started);
    expect(db.state.orders.find((o) => o.id === order.id)?.status).toBe('pending_payment');
    expect(db.state.types.get('tt-1')?.quantityReserved).toBe(3);
  });

  it('expires once the cutoff has passed, with the 20-minute note', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
    const svc = build(db);
    const order = await svc.createOrder(input);
    expect(await svc.expireLapsedHolds(plus(CUTOFF_MIN, 1))).toEqual({ expired: 1, failed: 0 });
    expect(db.state.orders.find((o) => o.id === order.id)?.status).toBe('expired');
    expect(db.state.types.get('tt-1')?.quantityReserved).toBe(0);
    expect(db.state.events.at(-1)).toMatchObject({
      action: 'order.expired',
      note: `${HOLD_MINUTES}-minute hold lapsed; 3 released`,
    });
  });

  it('asks the repository for holds that ended before now minus the grace', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
    const spy = vi.spyOn(db.orders, 'listLapsedHolds');
    await build(db).expireLapsedHolds(plus(30));
    expect(spy).toHaveBeenCalledWith(plus(30 - HOLD_GRACE_MINUTES), 200);
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

// After an on-sale rush every abandoned checkout lapses in the same minute:
// one run must bring them all back on sale, in bounded batches, and an order
// that keeps failing must neither stop the rest nor keep the run going.
describe('ordersService.expireLapsedHolds: batches', () => {
  const later = plus(CUTOFF_MIN, 1);

  /**
   * `n` lapsed one-ticket holds on tt-1 (cloned from one real order), plus
   * `bad` older ones on a ticket type whose counter cannot release — a
   * corrupted row that fails on every attempt.
   */
  async function lapsedHolds(n: number, bad = 0) {
    const db = fakeDb({
      events: [event()],
      ticketTypes: [ticketType({ quantityTotal: 10_000 }), ticketType({ id: 'tt-bad' })],
    });
    const template = await build(db).createOrder({
      ...input,
      quantity: 1,
      attendeeNames: ['A B'],
    });
    db.state.orders.length = 0;
    db.state.events.length = 0;
    for (let i = 0; i < bad; i++) {
      db.state.orders.push({
        ...template,
        id: `bad-${i}`,
        ticketTypeId: 'tt-bad',
        holdExpiresAt: new Date(template.holdExpiresAt!.getTime() - 1),
      });
    }
    for (let i = 0; i < n; i++) db.state.orders.push({ ...template, id: `bulk-${i}` });
    db.state.types.get('tt-1')!.quantityReserved = n;
    const list = vi.spyOn(db.orders, 'listLapsedHolds');
    // Capture the fake's tx handle so big runs can skip its per-transaction
    // snapshot (rollback is not under test there).
    const tx = await db.runInTransaction(async (t) => t);
    const fast = <T>(fn: (t: DbExecutor) => Promise<T>) => fn(tx);
    return { db, list, fast };
  }

  const pending = (db: ReturnType<typeof fakeDb>) =>
    db.state.orders.filter((o) => o.status === 'pending_payment').length;

  it('expires more than one batch (450) in a single run', async () => {
    const { db, list, fast } = await lapsedHolds(450);
    const svc = build(db, { now: () => later, runInTransaction: fast });

    expect(await svc.expireLapsedHolds(later)).toEqual({ expired: 450, failed: 0 });
    expect(pending(db)).toBe(0);
    expect(db.state.types.get('tt-1')?.quantityReserved).toBe(0);
    expect(db.state.events.filter((e) => e.action === 'order.expired')).toHaveLength(450);
    // 200 + 200 + a short batch of 50 that ends the run.
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('stops after the batch cap (10 × 200); the next run takes the rest', async () => {
    const { db, list, fast } = await lapsedHolds(2_500);
    const svc = build(db, { now: () => later, runInTransaction: fast });

    expect(await svc.expireLapsedHolds(later)).toEqual({ expired: 2_000, failed: 0 });
    expect(list).toHaveBeenCalledTimes(10);
    expect(pending(db)).toBe(500);
    expect(db.state.types.get('tt-1')?.quantityReserved).toBe(500);

    expect(await svc.expireLapsedHolds(later)).toEqual({ expired: 500, failed: 0 });
    expect(pending(db)).toBe(0);
  });

  it('a failing order is skipped, counted once, rolled back, and the rest still expire', async () => {
    const { db, list } = await lapsedHolds(250, 1);
    const svc = build(db, { now: () => later });

    expect(await svc.expireLapsedHolds(later)).toEqual({ expired: 250, failed: 1 });
    expect(db.state.orders.find((o) => o.id === 'bad-0')?.status).toBe('pending_payment');
    expect(db.state.events.filter((e) => e.orderId === 'bad-0')).toHaveLength(0);
    expect(pending(db)).toBe(1);
    // Batch 1 (200, the bad one first) then a short one: it is not fetched forever.
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('a whole batch of failing orders ends the run instead of looping on them', async () => {
    const { db, list } = await lapsedHolds(3, 205);
    const svc = build(db, { now: () => later });

    expect(await svc.expireLapsedHolds(later)).toEqual({ expired: 3, failed: 205 });
    expect(pending(db)).toBe(205);
    expect(list.mock.calls.length).toBeLessThanOrEqual(3);

    // The next run retries them (and they fail again): each counted once per run.
    expect(await svc.expireLapsedHolds(later)).toEqual({ expired: 0, failed: 205 });
  });
});
