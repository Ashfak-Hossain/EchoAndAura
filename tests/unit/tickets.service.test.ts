import { describe, expect, it, vi } from 'vitest';
import {
  EventNotFoundError,
  InvalidAttendeeNameError,
  RenameLockedError,
  TicketCancelledError,
  TicketNotFoundError,
  TicketRenameConflictError,
} from '@/server/lib/errors';
import { createFulfilmentService } from '@/server/services/fulfilment.service';
import { createInventoryService } from '@/server/services/inventory.service';
import { createOrdersService } from '@/server/services/orders.service';
import { createTicketsService, normaliseTicketCode } from '@/server/services/tickets.service';
import { NOW, event, fakeDb, ticketType } from './helpers/fake-db';

const TRX = '9AB12CD34E';

/** Two issued tickets on one order; registration closes 2026-09-26. */
async function setup(now: () => Date = () => NOW) {
  const db = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
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
    quantity: 2,
    buyerName: 'Nusrat Jahan',
    buyerEmail: 'nusrat@example.com',
    buyerPhone: '+8801712345678',
    attendeeNames: ['Nusrat Jahan', 'Tanvir Alam'],
  });
  await orders.submitPayment(order.id, { trxId: TRX, senderMsisdn: '+8801712345678' });
  const { tickets } = await createFulfilmentService({
    orders: db.orders,
    tickets: db.tickets,
    ticketTypes: db.ticketTypes,
    inventory,
    runInTransaction: db.runInTransaction,
    onTicketsIssued: async () => {},
  }).approveOrder(order.id, { actor: 'raj@example.com', verifiedTrxId: TRX });

  const svc = createTicketsService({
    tickets: db.tickets,
    orders: db.orders,
    events: db.events,
    ticketTypes: db.ticketTypes,
    runInTransaction: db.runInTransaction,
    now,
  });
  return { db, svc, order, tickets };
}

describe('ticketsService.getTicketByCode', () => {
  it('finds a ticket by its (normalised) code with event, type, position and siblings', async () => {
    const { svc, order, tickets } = await setup();
    const view = await svc.getTicketByCode(` ${tickets[1]!.code.toLowerCase()} `);
    expect(view.ticket.id).toBe(tickets[1]!.id);
    expect(view.order).toEqual({ id: order.id, reference: order.reference, quantity: 2 });
    expect(view.event.slug).toBe('live-dhaka');
    expect(view.ticketType.name).toBe('General');
    expect(view.position).toBe(2);
    expect(view.siblings).toHaveLength(2);
    expect(view.canRename).toBe(true);
    expect(view.renameLockedAt?.toISOString()).toBe('2026-09-26T13:00:00.000Z');
    expect(normaliseTicketCode(' tkt-abc ')).toBe('TKT-ABC');
  });

  it('404s an unknown code', async () => {
    const { svc } = await setup();
    await expect(svc.getTicketByCode('TKT-NOPE0000')).rejects.toBeInstanceOf(TicketNotFoundError);
  });

  it('reports the rename window closed once registration has closed', async () => {
    const { svc, tickets } = await setup(() => new Date('2026-09-27T00:00:00Z'));
    const view = await svc.getTicketByCode(tickets[0]!.code);
    expect(view.canRename).toBe(false);
    expect(view.renameLockedAt?.toISOString()).toBe('2026-09-26T13:00:00.000Z');
  });
});

describe('ticketsService.renameAttendee', () => {
  it('renames, collapses whitespace, keeps the code, and writes an audit row', async () => {
    const { db, svc, order, tickets } = await setup();
    const updated = await svc.renameAttendee(tickets[0]!.code, '  Farhana   Rahman ');
    expect(updated).toMatchObject({ code: tickets[0]!.code, attendeeName: 'Farhana Rahman' });
    expect(db.state.events.at(-1)).toMatchObject({
      orderId: order.id,
      actor: 'buyer',
      action: 'ticket.renamed',
      fromStatus: null,
      toStatus: null,
      note: `${tickets[0]!.code}: Nusrat Jahan → Farhana Rahman`,
    });
  });

  // Failure paths: each refusal happens before any write.
  it('refuses a bad name, an unknown code, a locked window and a cancelled ticket', async () => {
    const { db, svc, tickets } = await setup();
    const events = db.state.events.length;
    await expect(svc.renameAttendee(tickets[0]!.code, ' A ')).rejects.toBeInstanceOf(
      InvalidAttendeeNameError,
    );
    await expect(svc.renameAttendee('TKT-NOPE0000', 'Some One')).rejects.toBeInstanceOf(
      TicketNotFoundError,
    );

    const cancelled = db.state.tickets.find((t) => t.id === tickets[1]!.id)!;
    cancelled.status = 'cancelled';
    await expect(svc.renameAttendee(tickets[1]!.code, 'Some One')).rejects.toBeInstanceOf(
      TicketCancelledError,
    );
    expect(db.state.events).toHaveLength(events);

    const { svc: late, tickets: lateTickets } = await setup(() => new Date('2026-09-27T00:00:00Z'));
    const err = await late.renameAttendee(lateTickets[0]!.code, 'Some One').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RenameLockedError);
    expect((err as RenameLockedError).lockedAt?.toISOString()).toBe('2026-09-26T13:00:00.000Z');
  });

  // A missing close date locks rather than opens: never a silent free-for-all.
  it('locks renames when the event has no registration close date', async () => {
    // Orders need an open window to exist; the close date is removed afterwards.
    const { db, svc, tickets } = await setup();
    const ev = await db.events.findById('ev-1');
    ev!.registrationClosesAt = null;
    const view = await svc.getTicketByCode(tickets[0]!.code);
    expect(view.canRename).toBe(false);
    expect(view.renameLockedAt).toBeNull();
    const err = await svc.renameAttendee(tickets[0]!.code, 'Some One').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RenameLockedError);
    expect((err as RenameLockedError).lockedAt).toBeNull();
  });

  // The pre-check saw `issued`; a cancel or another rename landed before the
  // compare-and-swap. Refused, and no audit row claims a rename happened.
  it('refuses when the ticket changed between the read and the write, writing nothing', async () => {
    const { db, svc, tickets } = await setup();
    const events = db.state.events.length;
    (db.tickets.updateAttendeeName as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await expect(svc.renameAttendee(tickets[0]!.code, 'Some One')).rejects.toBeInstanceOf(
      TicketRenameConflictError,
    );
    expect(db.state.events).toHaveLength(events);
    expect(db.state.tickets.find((t) => t.id === tickets[0]!.id)?.attendeeName).toBe(
      'Nusrat Jahan',
    );
  });
});

describe('ticketsService.checkInList (B11)', () => {
  const byName = { column: 'name', desc: false } as const;

  it('lists issued tickets A–Z with type and order reference, no buyer contact', async () => {
    const { svc, order } = await setup();
    const list = await svc.checkInList('ev-1', { q: '', sort: byName });
    expect(list.event.id).toBe('ev-1');
    expect(list.total).toBe(2);
    expect(list.cancelled).toBe(0);
    expect(list.rows.map((r) => r.attendeeName)).toEqual(['Nusrat Jahan', 'Tanvir Alam']);
    expect(list.rows[0]).toMatchObject({
      orderId: order.id,
      orderReference: order.reference,
      ticketTypeName: 'General',
    });
    expect(list.rows[0]!.code).toMatch(/^TKT-/);
    expect(JSON.stringify(list.rows)).not.toContain('nusrat@example.com');
    expect(JSON.stringify(list.rows)).not.toContain('+8801712345678');
  });

  // A cancelled ticket is not a seat: counted for the footer, never listed,
  // and `total` (the "N names" figure) excludes it too.
  it('leaves cancelled tickets out of the list and the total, but counts them', async () => {
    const { db, svc, tickets } = await setup();
    db.state.tickets.find((t) => t.id === tickets[1]!.id)!.status = 'cancelled';
    const list = await svc.checkInList('ev-1', { q: '', sort: byName });
    expect(list.rows.map((r) => r.id)).toEqual([tickets[0]!.id]);
    expect(list.total).toBe(1);
    expect(list.cancelled).toBe(1);
  });

  it('searches by name, code or reference in memory; total ignores the search', async () => {
    const { svc, order, tickets } = await setup();
    const byCode = await svc.checkInList('ev-1', {
      q: tickets[1]!.code.slice(4).toLowerCase(),
      sort: byName,
    });
    expect(byCode.rows.map((r) => r.id)).toEqual([tickets[1]!.id]);
    expect(byCode.total).toBe(2);

    const byRef = await svc.checkInList('ev-1', { q: order.reference.slice(3), sort: byName });
    expect(byRef.rows).toHaveLength(2);

    const byPart = await svc.checkInList('ev-1', { q: 'TANVIR', sort: byName });
    expect(byPart.rows.map((r) => r.attendeeName)).toEqual(['Tanvir Alam']);

    const none = await svc.checkInList('ev-1', { q: 'nobody', sort: byName });
    expect(none.rows).toEqual([]);
    expect(none.total).toBe(2);
  });

  it('counts who is checked in and filters to In or Not yet (ADR-030), with the search', async () => {
    const { db, svc, tickets } = await setup();
    Object.assign(db.state.tickets[1]!, {
      checkedInAt: NOW,
      checkedInBy: 'Gate A',
      checkedInScanId: 'scan-1',
    });
    const all = await svc.checkInList('ev-1', { q: '', sort: byName });
    expect(all).toMatchObject({ total: 2, checkedIn: 1 });
    expect(all.rows).toHaveLength(2);

    const inside = await svc.checkInList('ev-1', { q: '', sort: byName, show: 'in' });
    expect(inside.rows.map((r) => r.id)).toEqual([tickets[1]!.id]);
    expect(inside).toMatchObject({ total: 2, checkedIn: 1 }); // counts are never filtered

    const notYet = await svc.checkInList('ev-1', { q: '', sort: byName, show: 'out' });
    expect(notYet.rows.map((r) => r.id)).toEqual([tickets[0]!.id]);

    const both = await svc.checkInList('ev-1', { q: 'nusrat', sort: byName, show: 'in' });
    expect(both.rows).toEqual([]);
  });

  it('sorts by the requested column and direction', async () => {
    const { svc } = await setup();
    const desc = await svc.checkInList('ev-1', { q: '', sort: { column: 'name', desc: true } });
    expect(desc.rows.map((r) => r.attendeeName)).toEqual(['Tanvir Alam', 'Nusrat Jahan']);
  });

  it('404s an unknown event', async () => {
    const { svc } = await setup();
    await expect(svc.checkInList('ev-nope', { q: '', sort: byName })).rejects.toBeInstanceOf(
      EventNotFoundError,
    );
  });
});
