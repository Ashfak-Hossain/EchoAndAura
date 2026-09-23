import { describe, expect, it, vi } from 'vitest';
import {
  InvalidQuantityError,
  SoldOutError,
  TicketCodeCollisionError,
  TicketTypeNotFoundError,
} from '@/server/lib/errors';
import { createFulfilmentService } from '@/server/services/fulfilment.service';
import { createInventoryService } from '@/server/services/inventory.service';
import { complimentaryTicketsFormSchema } from '@/lib/validation/complimentary-tickets';
import { event, fakeDb, ticketType } from './helpers/fake-db';

/**
 * B13 comps with the in-memory database: real stock is taken through the
 * same hold + convert every order uses, the order is born `issued` at ৳0
 * with the whole subtotal as its discount, one audit row names the reason
 * and the codes, and a refusal leaves nothing behind.
 */
const ACTOR = 'raj@example.com';
const INPUT = {
  eventId: 'ev-1',
  ticketTypeId: 'tt-2',
  quantity: 2,
  guestName: 'Tahmina Akter',
  guestEmail: 'tahmina@dhakapress.com',
  reason: 'Press — Dhaka Press review',
  actor: ACTOR,
};

function setup(
  opts: {
    vipLeft?: number;
    ticketCode?: () => string;
    orderReference?: () => string;
    onTicketsIssued?: (id: string) => Promise<void>;
  } = {},
) {
  const db = fakeDb({
    events: [event(), event({ id: 'ev-2', slug: 'other' })],
    ticketTypes: [
      ticketType({ quantityTotal: 20 }),
      ticketType({
        id: 'tt-2',
        name: 'VIP',
        pricePaisa: 350_000,
        quantityTotal: 10,
        quantitySold: 10 - (opts.vipLeft ?? 6),
      }),
      ticketType({ id: 'tt-9', eventId: 'ev-2', name: 'Other event' }),
    ],
  });
  const onTicketsIssued = vi.fn(opts.onTicketsIssued ?? (async () => {}));
  const fulfilment = createFulfilmentService({
    orders: db.orders,
    tickets: db.tickets,
    ticketTypes: db.ticketTypes,
    inventory: createInventoryService(db.inventoryRepo),
    runInTransaction: db.runInTransaction,
    onTicketsIssued,
    ticketCode: opts.ticketCode,
    orderReference: opts.orderReference,
  });
  return { db, fulfilment, onTicketsIssued };
}

describe('fulfilmentService.issueComplimentaryTickets', () => {
  it('takes real stock, is born issued at ৳0, one ticket per seat with the one name', async () => {
    const { db, fulfilment, onTicketsIssued } = setup();

    const { order, tickets } = await fulfilment.issueComplimentaryTickets(INPUT);

    expect(order).toMatchObject({
      status: 'issued',
      eventId: 'ev-1',
      ticketTypeId: 'tt-2',
      quantity: 2,
      unitPricePaisa: 350_000,
      subtotalPaisa: 700_000,
      discountPaisa: 700_000,
      totalPaisa: 0,
      buyerName: 'Tahmina Akter',
      buyerEmail: 'tahmina@dhakapress.com',
      buyerPhone: null,
      complimentaryReason: 'Press — Dhaka Press review',
      holdExpiresAt: null,
      bkashTrxId: null,
      promoCodeId: null,
    });
    // Held and converted in the same transaction: sold +2, nothing left held.
    expect(db.state.types.get('tt-2')).toMatchObject({ quantitySold: 6, quantityReserved: 0 });
    expect(tickets.map((t) => [t.position, t.attendeeName, t.status])).toEqual([
      [1, 'Tahmina Akter', 'issued'],
      [2, 'Tahmina Akter', 'issued'],
    ]);

    const audit = db.state.events.filter((e) => e.orderId === order.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: ACTOR,
      action: 'order.comp_issued',
      fromStatus: null,
      toStatus: 'issued',
    });
    expect(audit[0]?.note).toBe(
      `2 × VIP · complimentary — Press — Dhaka Press review · ${tickets.map((t) => t.code).join(', ')}`,
    );
    expect(db.txCalls).toEqual({ started: 1, committed: 1, rolledBack: 0 });
    expect(onTicketsIssued).toHaveBeenCalledWith(order.id);
  });

  it('asking for more than is left is SoldOutError — nothing written, no email', async () => {
    const { db, fulfilment, onTicketsIssued } = setup({ vipLeft: 1 });

    await expect(fulfilment.issueComplimentaryTickets(INPUT)).rejects.toBeInstanceOf(SoldOutError);

    expect(db.state.orders).toHaveLength(0);
    expect(db.state.tickets).toHaveLength(0);
    expect(db.state.events).toHaveLength(0);
    expect(db.state.types.get('tt-2')).toMatchObject({ quantitySold: 9, quantityReserved: 0 });
    expect(onTicketsIssued).not.toHaveBeenCalled();
  });

  it('a ticket type of another event, or none at all, is not found — before any stock moves', async () => {
    const { db, fulfilment } = setup();
    await expect(
      fulfilment.issueComplimentaryTickets({ ...INPUT, ticketTypeId: 'tt-9' }),
    ).rejects.toBeInstanceOf(TicketTypeNotFoundError);
    await expect(
      fulfilment.issueComplimentaryTickets({ ...INPUT, ticketTypeId: 'nope' }),
    ).rejects.toBeInstanceOf(TicketTypeNotFoundError);
    expect(db.txCalls.started).toBe(0);
  });

  it('refuses a quantity outside 1–10, like any order', async () => {
    const { db, fulfilment } = setup();
    await expect(
      fulfilment.issueComplimentaryTickets({ ...INPUT, quantity: 11 }),
    ).rejects.toBeInstanceOf(InvalidQuantityError);
    await expect(
      fulfilment.issueComplimentaryTickets({ ...INPUT, quantity: 0 }),
    ).rejects.toBeInstanceOf(InvalidQuantityError);
    expect(db.state.orders).toHaveLength(0);
  });

  it('retries the whole transaction on a reference collision and on a code collision', async () => {
    const refs = ['EA-TAKEN', 'EA-FRESH1'];
    const codes = ['TKT-DUP', 'TKT-DUP', 'TKT-A', 'TKT-B'];
    const { db, fulfilment } = setup({
      orderReference: () => refs.shift() ?? 'EA-FRESH2',
      ticketCode: () => codes.shift() ?? 'TKT-Z',
    });
    db.takenRefs.add('EA-TAKEN');

    const { order, tickets } = await fulfilment.issueComplimentaryTickets(INPUT);

    // Attempt 1: reference taken. Attempt 2: codes collide. Attempt 3 commits.
    expect(order.reference).toBe('EA-FRESH2');
    expect(tickets.map((t) => t.code)).toEqual(['TKT-A', 'TKT-B']);
    expect(db.txCalls).toEqual({ started: 3, committed: 1, rolledBack: 2 });
    // Every rolled-back attempt gave its seats back.
    expect(db.state.types.get('tt-2')).toMatchObject({ quantitySold: 6, quantityReserved: 0 });
  });

  it('gives up after three code collisions', async () => {
    const { db, fulfilment } = setup({ ticketCode: () => 'TKT-SAME' });
    await expect(fulfilment.issueComplimentaryTickets(INPUT)).rejects.toBeInstanceOf(
      TicketCodeCollisionError,
    );
    expect(db.state.orders).toHaveLength(0);
    expect(db.txCalls.rolledBack).toBe(3);
  });

  it('a failing email hook never undoes the tickets (after commit, Invariant 7)', async () => {
    const { db, fulfilment } = setup({
      onTicketsIssued: async () => {
        throw new Error('queue down');
      },
    });
    const { order } = await fulfilment.issueComplimentaryTickets(INPUT);
    expect(order.status).toBe('issued');
    expect(db.state.tickets).toHaveLength(2);
  });
});

describe('complimentaryTicketsFormSchema', () => {
  const ok = {
    ticketTypeId: '7b1a4c2e-3d5f-4a6b-9c8d-0e1f2a3b4c5d',
    quantity: '2',
    guestName: '  Tahmina Akter ',
    guestEmail: ' Tahmina@DhakaPress.com ',
    reason: ' Press review ',
  };

  it('parses the form and strips anything that is not a field — no price can be sent', () => {
    const r = complimentaryTicketsFormSchema.parse({ ...ok, totalPaisa: 0, unitPricePaisa: 1 });
    expect(r).toEqual({
      ticketTypeId: ok.ticketTypeId,
      quantity: 2,
      guestName: 'Tahmina Akter',
      guestEmail: 'tahmina@dhakapress.com',
      reason: 'Press review',
    });
  });

  it.each([
    ['reason missing', { reason: '' }, 'reason'],
    ['reason one letter', { reason: 'x' }, 'reason'],
    ['reason too long', { reason: 'x'.repeat(201) }, 'reason'],
    ['quantity 0', { quantity: '0' }, 'quantity'],
    ['quantity 11', { quantity: '11' }, 'quantity'],
    ['quantity 1.5', { quantity: '1.5' }, 'quantity'],
    ['bad email', { guestEmail: 'tahmina@' }, 'guestEmail'],
    ['name too short', { guestName: 'T' }, 'guestName'],
    ['not a ticket type id', { ticketTypeId: 'vip' }, 'ticketTypeId'],
  ])('refuses %s', (_label, patch, field) => {
    const r = complimentaryTicketsFormSchema.safeParse({ ...ok, ...patch });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path[0]).toBe(field);
  });
});
