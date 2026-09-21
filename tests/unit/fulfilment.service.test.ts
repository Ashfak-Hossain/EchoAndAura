import { describe, expect, it, vi } from 'vitest';
import {
  AttendeeNamesMismatchError,
  InvalidRejectionReasonError,
  InventoryStateError,
  OrderNotFoundError,
  OrderStatusConflictError,
  TicketCancelledError,
  TicketCodeCollisionError,
  TicketNotFoundError,
  TrxIdChangedError,
} from '@/server/lib/errors';
import type { RejectionReason } from '@/server/lib/rejection-reasons';
import { createFulfilmentService } from '@/server/services/fulfilment.service';
import { createInventoryService } from '@/server/services/inventory.service';
import { createOrdersService } from '@/server/services/orders.service';
import { NOW, event, fakeDb, ticketType } from './helpers/fake-db';

const ACTOR = 'raj@example.com';
const TRX = '9AB12CD34E';
const APPROVE = { actor: ACTOR, verifiedTrxId: TRX };

/** A db with one order already in pending_verification (3 × General held). */
async function setup(opts: { ticketCode?: () => string } = {}) {
  const db = fakeDb({ events: [event()], ticketTypes: [ticketType({ quantityTotal: 10 })] });
  const inventory = createInventoryService(db.inventoryRepo);
  const orders = createOrdersService({
    orders: db.orders,
    tickets: db.tickets,
    events: db.events,
    ticketTypes: db.ticketTypes,
    inventory,
    runInTransaction: db.runInTransaction,
    now: () => NOW,
  });
  const order = await orders.createOrder({
    eventSlug: 'live-dhaka',
    ticketTypeId: 'tt-1',
    quantity: 3,
    buyerName: 'Nusrat Jahan',
    buyerEmail: 'nusrat@example.com',
    buyerPhone: '+8801712345678',
    attendeeNames: ['Nusrat Jahan', 'Tanvir Alam', 'Farhana Rahman'],
  });
  await orders.submitPayment(order.id, { trxId: TRX, senderMsisdn: '+8801712345678' });

  const onTicketsIssued = vi.fn(async () => {});
  const fulfilment = createFulfilmentService({
    orders: db.orders,
    tickets: db.tickets,
    inventory,
    runInTransaction: db.runInTransaction,
    onTicketsIssued,
    ticketCode: opts.ticketCode,
  });
  return { db, orders, fulfilment, order, onTicketsIssued };
}

describe('fulfilmentService.approveOrder', () => {
  it('paid → issued in one transaction: held → sold, one ticket per name, two audit rows', async () => {
    const { db, fulfilment, order, onTicketsIssued } = await setup();
    const before = db.txCalls.started;

    const result = await fulfilment.approveOrder(order.id, APPROVE);

    expect(result.order.status).toBe('issued');
    expect(db.txCalls).toEqual({ started: before + 1, committed: before + 1, rolledBack: 0 });
    expect(db.state.types.get('tt-1')).toMatchObject({ quantitySold: 3, quantityReserved: 0 });

    expect(result.tickets.map((t) => t.attendeeName)).toEqual([
      'Nusrat Jahan',
      'Tanvir Alam',
      'Farhana Rahman',
    ]);
    for (const t of result.tickets) {
      expect(t.code).toMatch(/^TKT-[A-Z2-9]{8}$/);
      expect(t).toMatchObject({
        orderId: order.id,
        ticketTypeId: 'tt-1',
        eventId: 'ev-1',
        status: 'issued',
      });
    }
    expect(new Set(result.tickets.map((t) => t.code)).size).toBe(3);

    const audit = db.state.events.filter((e) => e.orderId === order.id).slice(-2);
    expect(audit[0]).toMatchObject({
      actor: ACTOR,
      action: 'payment.approved',
      fromStatus: 'pending_verification',
      toStatus: 'paid',
    });
    expect(audit[1]).toMatchObject({
      actor: ACTOR,
      action: 'tickets.issued',
      fromStatus: 'paid',
      toStatus: 'issued',
    });
    expect(onTicketsIssued).toHaveBeenCalledWith(order.id);
  });

  // Invariant 7: the email hook runs after the commit, never inside it.
  it('calls onTicketsIssued only after the transaction committed, and survives its failure', async () => {
    const sequence: string[] = [];
    const { db, order } = await setup();
    const original = db.runInTransaction;
    const f = createFulfilmentService({
      orders: db.orders,
      tickets: db.tickets,
      inventory: createInventoryService(db.inventoryRepo),
      runInTransaction: async (fn) => {
        const out = await original(fn);
        sequence.push('commit');
        return out;
      },
      onTicketsIssued: async (id) => {
        sequence.push('hook');
        throw new Error(`queue down for ${id}`);
      },
    });

    const result = await f.approveOrder(order.id, APPROVE);
    expect(result.order.status).toBe('issued'); // hook failure never undoes the tickets
    expect(sequence).toEqual(['commit', 'hook']);
  });

  it('retries the whole transaction on a ticket code collision, then gives up', async () => {
    const codes = [
      'TKT-SAME0001',
      'TKT-SAME0001',
      'TKT-SAME0001',
      'TKT-SAME0001',
      'TKT-A1',
      'TKT-A2',
      'TKT-A3',
    ];
    let i = 0;
    const { db, fulfilment, order } = await setup({ ticketCode: () => codes[i++] ?? `TKT-X${i}` });
    // First attempt hands out the same code three times → collision → rollback → retry.
    const result = await fulfilment.approveOrder(order.id, APPROVE);
    expect(result.tickets).toHaveLength(3);
    expect(db.txCalls.rolledBack).toBeGreaterThanOrEqual(1);
    expect(db.state.types.get('tt-1')).toMatchObject({ quantitySold: 3, quantityReserved: 0 });
    expect(db.state.tickets).toHaveLength(3); // nothing from the rolled-back attempt survived

    const { fulfilment: stuck, order: o2 } = await setup({ ticketCode: () => 'TKT-DUP00000' });
    await expect(stuck.approveOrder(o2.id, APPROVE)).rejects.toBeInstanceOf(
      TicketCodeCollisionError,
    );
  });

  it('refuses anything not awaiting verification, writing nothing', async () => {
    const { db, fulfilment, order } = await setup();
    await fulfilment.approveOrder(order.id, APPROVE);
    const events = db.state.events.length;
    const err = await fulfilment.approveOrder(order.id, APPROVE).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OrderStatusConflictError);
    expect((err as OrderStatusConflictError).status).toBe('issued');
    expect(db.state.events).toHaveLength(events);
    expect(db.state.tickets).toHaveLength(3);
    expect(db.state.types.get('tt-1')?.quantitySold).toBe(3);
    await expect(fulfilment.approveOrder('nope', APPROVE)).rejects.toBeInstanceOf(
      OrderNotFoundError,
    );
  });

  // The one-payment-two-orders hole: the buyer swaps the trxID after the
  // admin checked it. Approving by order id alone would issue tickets
  // against the swapped id and free the verified one for another order.
  it('refuses when the trxID changed after the admin verified it, writing nothing', async () => {
    const { db, orders, fulfilment, order } = await setup();
    await orders.submitPayment(order.id, { trxId: 'SWAPPED001', senderMsisdn: '+8801712345678' });
    const events = db.state.events.length;

    const err = await fulfilment.approveOrder(order.id, APPROVE).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TrxIdChangedError);
    expect((err as TrxIdChangedError).current).toBe('SWAPPED001');
    expect(db.state.orders.find((o) => o.id === order.id)?.status).toBe('pending_verification');
    expect(db.state.tickets).toHaveLength(0);
    expect(db.state.types.get('tt-1')).toMatchObject({ quantitySold: 0, quantityReserved: 3 });
    expect(db.state.events).toHaveLength(events);

    // Approving what is actually there now works.
    const ok = await fulfilment.approveOrder(order.id, {
      actor: ACTOR,
      verifiedTrxId: 'SWAPPED001',
    });
    expect(ok.order.status).toBe('issued');
  });

  it('refuses an order whose attendee names no longer match its quantity', async () => {
    const { db, fulfilment, order } = await setup();
    const row = db.state.orders.find((o) => o.id === order.id)!;
    row.attendeeNames = ['Only One'];
    await expect(fulfilment.approveOrder(order.id, APPROVE)).rejects.toBeInstanceOf(
      AttendeeNamesMismatchError,
    );
    expect(db.state.tickets).toHaveLength(0);
    expect(db.state.types.get('tt-1')?.quantitySold).toBe(0);
  });
});

describe('fulfilmentService.rejectOrder', () => {
  it('releases the hold, stores the reason and note, and audits with the buyer wording', async () => {
    const { db, fulfilment, order } = await setup();
    const rejected = await fulfilment.rejectOrder(order.id, {
      actor: ACTOR,
      reason: 'no_matching_credit',
      note: '  No credit of ৳3,600.00 appears for 9AB12CD34E. ',
    });
    expect(rejected).toMatchObject({
      status: 'rejected',
      rejectionReason: 'no_matching_credit',
      rejectionNote: 'No credit of ৳3,600.00 appears for 9AB12CD34E.',
    });
    expect(db.state.types.get('tt-1')).toMatchObject({ quantitySold: 0, quantityReserved: 0 });
    expect(db.state.events.at(-1)).toMatchObject({
      actor: ACTOR,
      action: 'payment.rejected',
      fromStatus: 'pending_verification',
      toStatus: 'rejected',
      note: 'No matching credit in the bKash statement — No credit of ৳3,600.00 appears for 9AB12CD34E.',
    });
    expect(db.state.tickets).toHaveLength(0);
  });

  it('refuses an unknown reason before any transaction, and a wrong status', async () => {
    const { db, fulfilment, order } = await setup();
    const started = db.txCalls.started;
    await expect(
      fulfilment.rejectOrder(order.id, { actor: ACTOR, reason: 'because' as RejectionReason }),
    ).rejects.toBeInstanceOf(InvalidRejectionReasonError);
    expect(db.txCalls.started).toBe(started);

    await fulfilment.rejectOrder(order.id, { actor: ACTOR, reason: 'duplicate_order' });
    await expect(
      fulfilment.rejectOrder(order.id, { actor: ACTOR, reason: 'duplicate_order' }),
    ).rejects.toBeInstanceOf(OrderStatusConflictError);
    await expect(fulfilment.approveOrder(order.id, APPROVE)).rejects.toBeInstanceOf(
      OrderStatusConflictError,
    );
    expect(db.state.types.get('tt-1')?.quantityReserved).toBe(0); // released exactly once
  });
});

describe('fulfilmentService.cancelTicket', () => {
  /** Three issued tickets on one order (sold 3 of 10). */
  async function issued() {
    const s = await setup();
    const { tickets } = await s.fulfilment.approveOrder(s.order.id, APPROVE);
    expect(s.db.state.types.get('tt-1')).toMatchObject({ quantitySold: 3, quantityReserved: 0 });
    return { ...s, tickets };
  }
  const input = (orderId: string, reason = 'Buyer asked, refunded by bKash') => ({
    orderId,
    actor: ACTOR,
    reason,
  });

  it('cancels one ticket: sold −1, reserved untouched, order still issued, audit row with the reason', async () => {
    const { db, fulfilment, order, tickets } = await issued();
    const started = db.txCalls.started;
    const result = await fulfilment.cancelTicket(tickets[1]!.id, input(order.id));

    expect(result.orderCancelled).toBe(false);
    expect(result.ticket).toMatchObject({ id: tickets[1]!.id, status: 'cancelled' });
    expect(result.order.status).toBe('issued');
    expect(db.state.types.get('tt-1')).toMatchObject({ quantitySold: 2, quantityReserved: 0 });
    expect(db.state.tickets.map((t) => t.status)).toEqual(['issued', 'cancelled', 'issued']);
    expect(db.state.orders.find((o) => o.id === order.id)?.status).toBe('issued');
    expect(db.state.events.at(-1)).toMatchObject({
      orderId: order.id,
      actor: ACTOR,
      action: 'ticket.cancelled',
      fromStatus: null,
      toStatus: null,
      note: `${tickets[1]!.code} (Tanvir Alam): Buyer asked, refunded by bKash`,
    });
    // One transaction, committed once; the seat came out of SOLD, never HELD.
    expect(db.txCalls.started).toBe(started + 1);
    expect(db.txCalls.committed).toBe(started + 1);
    expect(db.inventoryRepo.releaseSold).toHaveBeenCalledWith('tt-1', 1, expect.anything());
    expect(db.inventoryRepo.release).not.toHaveBeenCalled();
  });

  it('cancelling the last live ticket cancels the order in the same transaction', async () => {
    const { db, fulfilment, order, tickets } = await issued();
    for (const t of tickets.slice(0, 2)) await fulfilment.cancelTicket(t.id, input(order.id));
    const started = db.txCalls.started;

    const result = await fulfilment.cancelTicket(tickets[2]!.id, input(order.id, 'Event moved'));
    expect(result.orderCancelled).toBe(true);
    expect(result.order.status).toBe('cancelled');
    expect(db.txCalls.started).toBe(started + 1);
    expect(db.state.types.get('tt-1')).toMatchObject({ quantitySold: 0, quantityReserved: 0 });
    expect(db.state.events.slice(-2)).toMatchObject([
      { action: 'ticket.cancelled', note: `${tickets[2]!.code} (Farhana Rahman): Event moved` },
      {
        action: 'order.cancelled',
        actor: ACTOR,
        fromStatus: 'issued',
        toStatus: 'cancelled',
        note: 'all 3 tickets cancelled',
      },
    ]);
    // The order is over: nothing more can be cancelled, re-sent or approved.
    await expect(fulfilment.cancelTicket(tickets[0]!.id, input(order.id))).rejects.toBeInstanceOf(
      OrderStatusConflictError,
    );
    await expect(fulfilment.resendTicketsEmail(order.id, ACTOR)).rejects.toBeInstanceOf(
      OrderStatusConflictError,
    );
  });

  // Failure paths: every refusal leaves the counters, the ticket and the audit trail untouched.
  it('refuses an unknown ticket, a ticket from another order, and an already cancelled ticket', async () => {
    const { db, fulfilment, order, tickets } = await issued();
    const events = db.state.events.length;

    await expect(fulfilment.cancelTicket('tk-nope', input(order.id))).rejects.toBeInstanceOf(
      TicketNotFoundError,
    );
    // Right ticket, wrong order id: refused as "not found", never touched.
    await expect(
      fulfilment.cancelTicket(tickets[0]!.id, input('order-other')),
    ).rejects.toBeInstanceOf(OrderNotFoundError);
    const other = { ...db.state.orders[0]!, id: 'order-other', reference: 'EA-OTHER1' };
    db.state.orders.push(other);
    await expect(
      fulfilment.cancelTicket(tickets[0]!.id, input('order-other')),
    ).rejects.toBeInstanceOf(TicketNotFoundError);

    await fulfilment.cancelTicket(tickets[0]!.id, input(order.id));
    await expect(fulfilment.cancelTicket(tickets[0]!.id, input(order.id))).rejects.toBeInstanceOf(
      TicketCancelledError,
    );

    expect(db.state.types.get('tt-1')?.quantitySold).toBe(2); // released exactly once
    expect(db.state.events).toHaveLength(events + 1);
  });

  // The conditional UPDATE saw `issued` on read but lost the race by the
  // write: no seat is released and no audit row claims a cancel happened.
  it('releases nothing when the conditional cancel finds the ticket already changed', async () => {
    const { db, fulfilment, order, tickets } = await issued();
    const events = db.state.events.length;
    (db.tickets.cancel as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await expect(fulfilment.cancelTicket(tickets[0]!.id, input(order.id))).rejects.toBeInstanceOf(
      TicketCancelledError,
    );
    expect(db.inventoryRepo.releaseSold).not.toHaveBeenCalled();
    expect(db.state.types.get('tt-1')?.quantitySold).toBe(3);
    expect(db.state.events).toHaveLength(events);
    expect(db.txCalls.rolledBack).toBe(1);
  });

  it('rolls the ticket flip back when the inventory write fails', async () => {
    const { db, fulfilment, order, tickets } = await issued();
    const events = db.state.events.length;
    (db.inventoryRepo.releaseSold as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new InventoryStateError('tt-1', 'releaseSold'),
    );
    await expect(fulfilment.cancelTicket(tickets[0]!.id, input(order.id))).rejects.toBeInstanceOf(
      InventoryStateError,
    );
    expect(db.state.tickets[0]?.status).toBe('issued');
    expect(db.state.types.get('tt-1')?.quantitySold).toBe(3);
    expect(db.state.events).toHaveLength(events);
  });
});
