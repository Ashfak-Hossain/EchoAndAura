import { describe, expect, it, vi } from 'vitest';
import { EmailSkippedError, createEmailDispatcher } from '@/server/email/dispatch';
import { OrderStatusConflictError } from '@/server/lib/errors';
import type { Mailer, OutgoingEmail } from '@/server/email/mailer';
import { createFulfilmentService } from '@/server/services/fulfilment.service';
import { createInventoryService } from '@/server/services/inventory.service';
import { createOrdersService } from '@/server/services/orders.service';
import { NOW, event, fakeDb, ticketType } from './helpers/fake-db';

const TRX = '9AB12CD34E';

async function setup() {
  const db = fakeDb({ events: [event()], ticketTypes: [ticketType({ quantityTotal: 10 })] });
  const inventory = createInventoryService(db.inventoryRepo);
  const created: string[] = [];
  const expiredHook: string[] = [];
  const orders = createOrdersService({
    orders: db.orders,
    tickets: db.tickets,
    events: db.events,
    ticketTypes: db.ticketTypes,
    inventory,
    runInTransaction: db.runInTransaction,
    now: () => NOW,
    onOrderCreated: async (id) => {
      created.push(id);
    },
    onOrderExpired: async (id) => {
      expiredHook.push(id);
    },
  });
  const issuedHook: string[] = [];
  const rejectedHook: string[] = [];
  const fulfilment = createFulfilmentService({
    orders: db.orders,
    tickets: db.tickets,
    inventory,
    runInTransaction: db.runInTransaction,
    onTicketsIssued: async (id) => {
      issuedHook.push(id);
    },
    onOrderRejected: async (id) => {
      rejectedHook.push(id);
    },
  });
  const sent: OutgoingEmail[] = [];
  const mailer: Mailer = {
    send: vi.fn(async (m: OutgoingEmail) => {
      sent.push(m);
      return { messageId: `m-${sent.length}` };
    }),
  };
  const renderPdf = vi.fn(async () => Buffer.from('%PDF-fake'));
  const dispatcher = createEmailDispatcher({
    orders,
    ordersRepo: db.orders,
    ticketTypes: db.ticketTypes,
    mailer,
    renderPdf,
    now: () => NOW,
    env: {
      siteUrl: 'https://echoandaura.com',
      bkashNumber: '01712 345678',
      contactEmail: 'hello@echoandaura.com',
      contactPhone: null,
    },
  });
  const order = await orders.createOrder({
    eventSlug: 'live-dhaka',
    ticketTypeId: 'tt-1',
    quantity: 2,
    buyerName: 'Nusrat Jahan',
    buyerEmail: 'nusrat@example.com',
    buyerPhone: '+8801712345678',
    attendeeNames: ['Nusrat Jahan', 'Tanvir Alam'],
  });
  return {
    db,
    orders,
    fulfilment,
    dispatcher,
    mailer,
    sent,
    renderPdf,
    order,
    hooks: { created, issuedHook, rejectedHook, expiredHook },
  };
}

describe('after-commit email hooks', () => {
  it('fire once per event, after the transaction, with the order id', async () => {
    const { db, orders, fulfilment, order, hooks } = await setup();
    expect(hooks.created).toEqual([order.id]);

    await orders.submitPayment(order.id, { trxId: TRX, senderMsisdn: '+8801712345678' });
    await fulfilment.approveOrder(order.id, { actor: 'raj@example.com', verifiedTrxId: TRX });
    expect(hooks.issuedHook).toEqual([order.id]);

    const other = await orders.createOrder({
      eventSlug: 'live-dhaka',
      ticketTypeId: 'tt-1',
      quantity: 1,
      buyerName: 'Tanvir Alam',
      buyerEmail: 't@example.com',
      buyerPhone: '+8801712345678',
      attendeeNames: ['Tanvir Alam'],
    });
    await orders.submitPayment(other.id, { trxId: 'ZZ99ZZ99ZZ', senderMsisdn: '+8801712345678' });
    await fulfilment.rejectOrder(other.id, { actor: 'raj@example.com', reason: 'duplicate_order' });
    expect(hooks.rejectedHook).toEqual([other.id]);

    const third = await orders.createOrder({
      eventSlug: 'live-dhaka',
      ticketTypeId: 'tt-1',
      quantity: 1,
      buyerName: 'Late Buyer',
      buyerEmail: 'l@example.com',
      buyerPhone: '+8801712345678',
      attendeeNames: ['Late Buyer'],
    });
    await orders.expireLapsedHolds(new Date(NOW.getTime() + 25 * 3_600_000));
    expect(hooks.expiredHook).toEqual([third.id]);
    expect(db.state.orders.find((o) => o.id === third.id)?.status).toBe('expired');
  });

  it('a throwing hook is logged, never surfaced, and the write stands', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
    const orders = createOrdersService({
      orders: db.orders,
      tickets: db.tickets,
      events: db.events,
      ticketTypes: db.ticketTypes,
      inventory: createInventoryService(db.inventoryRepo),
      runInTransaction: db.runInTransaction,
      now: () => NOW,
      onOrderCreated: async () => {
        throw new Error('redis down');
      },
    });
    const order = await orders.createOrder({
      eventSlug: 'live-dhaka',
      ticketTypeId: 'tt-1',
      quantity: 1,
      buyerName: 'A B',
      buyerEmail: 'a@example.com',
      buyerPhone: '+8801712345678',
      attendeeNames: ['A B'],
    });
    expect(order.status).toBe('pending_payment');
    expect(db.state.types.get('tt-1')?.quantityReserved).toBe(1);
  });
});

describe('emailDispatcher.dispatch', () => {
  it('sends C1 for a fresh order and writes the audit row', async () => {
    const { db, dispatcher, sent, renderPdf, order } = await setup();
    const out = await dispatcher.dispatch('payment-instructions', order.id);
    expect(out.messageId).toBe('m-1');
    expect(sent[0]).toMatchObject({ to: 'nusrat@example.com', replyTo: 'hello@echoandaura.com' });
    expect(sent[0]?.subject).toContain(order.reference);
    expect(sent[0]?.attachments).toBeUndefined();
    expect(renderPdf).not.toHaveBeenCalled();
    expect(db.state.events.at(-1)).toMatchObject({
      orderId: order.id,
      actor: 'system',
      action: 'email.sent',
      note: `payment-instructions → nusrat@example.com · m-1`,
    });
  });

  it('sends C2 with the PDF attached once tickets are issued, and refuses it before', async () => {
    const { db, orders, fulfilment, dispatcher, sent, renderPdf, order } = await setup();
    await expect(dispatcher.dispatch('tickets-issued', order.id)).rejects.toBeInstanceOf(
      EmailSkippedError,
    );
    expect(db.state.events.at(-1)).toMatchObject({ action: 'email.skipped' });
    expect(sent).toHaveLength(0);

    await orders.submitPayment(order.id, { trxId: TRX, senderMsisdn: '+8801712345678' });
    await fulfilment.approveOrder(order.id, { actor: 'raj@example.com', verifiedTrxId: TRX });
    await dispatcher.dispatch('tickets-issued', order.id);
    expect(renderPdf).toHaveBeenCalledTimes(1);
    expect(sent[0]?.attachments).toEqual([
      {
        filename: `tickets-${order.reference}.pdf`,
        content: Buffer.from('%PDF-fake'),
        contentType: 'application/pdf',
      },
    ]);
    expect(sent[0]?.html).toContain('TKT-');
  });

  it('C3 and C4 only go to orders in that state', async () => {
    const { orders, fulfilment, dispatcher, sent, order } = await setup();
    await expect(dispatcher.dispatch('rejected', order.id)).rejects.toBeInstanceOf(
      EmailSkippedError,
    );
    await orders.submitPayment(order.id, { trxId: TRX, senderMsisdn: '+8801712345678' });
    await fulfilment.rejectOrder(order.id, {
      actor: 'raj@example.com',
      reason: 'amount_mismatch',
      note: 'You sent ৳2,000.00.',
    });
    await dispatcher.dispatch('rejected', order.id);
    expect(sent[0]?.html).toContain('You sent ৳2,000.00.');
    await expect(dispatcher.dispatch('expired', order.id)).rejects.toBeInstanceOf(
      EmailSkippedError,
    );
  });

  // The dangerous window: the message is out, then the audit write fails.
  // A throw here would make BullMQ retry — and re-send.
  it('a failed audit write after a successful send never fails the job (no duplicate email)', async () => {
    const { db, dispatcher, mailer, order } = await setup();
    const insert = db.orders.insertEvent as ReturnType<typeof vi.fn>;
    insert.mockRejectedValueOnce(new Error('postgres blip'));
    const out = await dispatcher.dispatch('payment-instructions', order.id);
    expect(out.messageId).toBe('m-1');
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  it('a failed send writes no email.sent row and rejects so BullMQ retries', async () => {
    const { db, orders, order } = await setup();
    const broken = createEmailDispatcher({
      orders,
      ordersRepo: db.orders,
      ticketTypes: db.ticketTypes,
      mailer: {
        send: vi.fn(async () => {
          throw new Error('ses down');
        }),
      },
      env: { siteUrl: 'https://x', bkashNumber: null, contactEmail: null, contactPhone: null },
    });
    const before = db.state.events.length;
    await expect(broken.dispatch('payment-instructions', order.id)).rejects.toThrow('ses down');
    expect(db.state.events).toHaveLength(before);
  });

  it('C1 is skipped once the hold has lapsed, even while the row is still pending_payment', async () => {
    const { db, orders, order } = await setup();
    const late = createEmailDispatcher({
      orders,
      ordersRepo: db.orders,
      ticketTypes: db.ticketTypes,
      mailer: { send: vi.fn(async () => ({ messageId: 'x' })) },
      now: () => new Date(NOW.getTime() + 25 * 3_600_000),
      env: { siteUrl: 'https://x', bkashNumber: null, contactEmail: null, contactPhone: null },
    });
    await expect(late.dispatch('payment-instructions', order.id)).rejects.toBeInstanceOf(
      EmailSkippedError,
    );
    expect(db.state.events.at(-1)).toMatchObject({ action: 'email.skipped' });
  });
});

describe('after-commit ordering (Invariant 7)', () => {
  it('created, rejected and expired hooks all run after their transaction committed', async () => {
    const seq: string[] = [];
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType({ quantityTotal: 10 })] });
    const inventory = createInventoryService(db.inventoryRepo);
    const original = db.runInTransaction;
    const tracked = async <T>(fn: (tx: import('@/db/executor').DbExecutor) => Promise<T>) => {
      const out = await original(fn);
      seq.push('commit');
      return out;
    };
    const orders = createOrdersService({
      orders: db.orders,
      tickets: db.tickets,
      events: db.events,
      ticketTypes: db.ticketTypes,
      inventory,
      runInTransaction: tracked,
      now: () => NOW,
      onOrderCreated: async () => {
        seq.push('created-hook');
      },
      onOrderExpired: async () => {
        seq.push('expired-hook');
      },
    });
    const fulfilment = createFulfilmentService({
      orders: db.orders,
      tickets: db.tickets,
      inventory,
      runInTransaction: tracked,
      onTicketsIssued: async () => {},
      onOrderRejected: async () => {
        seq.push('rejected-hook');
      },
    });
    const mk = (name: string) =>
      orders.createOrder({
        eventSlug: 'live-dhaka',
        ticketTypeId: 'tt-1',
        quantity: 1,
        buyerName: name,
        buyerEmail: 'a@example.com',
        buyerPhone: '+8801712345678',
        attendeeNames: [name],
      });

    const a = await mk('A');
    expect(seq).toEqual(['commit', 'created-hook']);
    seq.length = 0;
    await orders.submitPayment(a.id, { trxId: 'REJ0000001', senderMsisdn: '+8801712345678' });
    seq.length = 0;
    await fulfilment.rejectOrder(a.id, { actor: 'raj', reason: 'duplicate_order' });
    expect(seq).toEqual(['commit', 'rejected-hook']);

    await mk('B');
    seq.length = 0;
    await orders.expireLapsedHolds(new Date(NOW.getTime() + 25 * 3_600_000));
    expect(seq).toEqual(['commit', 'expired-hook']);
  });
});

describe('fulfilmentService.resendTicketsEmail', () => {
  it('records who asked before enqueueing, only for issued orders, and surfaces a queue failure', async () => {
    const { db, orders, order } = await setup();
    const asked: string[] = [];
    const svc = createFulfilmentService({
      orders: db.orders,
      tickets: db.tickets,
      inventory: createInventoryService(db.inventoryRepo),
      runInTransaction: db.runInTransaction,
      onTicketsIssued: async () => {},
      onTicketsResendRequested: async (id) => {
        asked.push(id);
      },
    });
    await expect(svc.resendTicketsEmail(order.id, 'raj@example.com')).rejects.toBeInstanceOf(
      OrderStatusConflictError,
    );
    await orders.submitPayment(order.id, { trxId: TRX, senderMsisdn: '+8801712345678' });
    await svc.approveOrder(order.id, { actor: 'raj@example.com', verifiedTrxId: TRX });
    await svc.resendTicketsEmail(order.id, 'raj@example.com');
    expect(asked).toEqual([order.id]);
    expect(db.state.events.at(-1)).toMatchObject({
      actor: 'raj@example.com',
      action: 'email.resend_requested',
    });

    const broken = createFulfilmentService({
      orders: db.orders,
      tickets: db.tickets,
      inventory: createInventoryService(db.inventoryRepo),
      runInTransaction: db.runInTransaction,
      onTicketsIssued: async () => {},
      onTicketsResendRequested: async () => {
        throw new Error('redis down');
      },
    });
    await expect(broken.resendTicketsEmail(order.id, 'raj@example.com')).rejects.toThrow(
      'redis down',
    );
    // The request is still on record — the audit row went in first.
    expect(db.state.events.at(-1)).toMatchObject({ action: 'email.resend_requested' });
  });
});
