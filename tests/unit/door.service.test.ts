import { describe, expect, it, vi } from 'vitest';
import {
  CheckInUndoRefusedError,
  DoorPassCodeCollisionError,
  DoorPassNotAllowedError,
  DoorPassNotFoundError,
  DoorPassRevokedError,
  TicketNotFoundError,
} from '@/server/lib/errors';
import type { EventRecord } from '@/server/repositories/events.repository';
import { type DoorContext, type ScanItem, createDoorService } from '@/server/services/door.service';
import { createFulfilmentService } from '@/server/services/fulfilment.service';
import { createInventoryService } from '@/server/services/inventory.service';
import { createOrdersService } from '@/server/services/orders.service';
import { NOW, event, fakeDb, ticketType } from './helpers/fake-db';
import { fakeDoor } from './helpers/fake-door';

const TRX = '9AB12CD34E';
const HOUR = 60 * 60_000;
const CODE_A = 'K7QM4XPDR2TW';
const CODE_B = 'H3JN8WQZ5YVC';

let scanSeq = 0;
/** A fresh scan id per call, like a phone's crypto.randomUUID(). */
const sid = () => `00000000-0000-4000-a000-${String(++scanSeq).padStart(12, '0')}`;

/**
 * Two issued tickets (Nusrat Jahan, Tanvir Alam) on one order, then a door
 * service whose event starts an hour after NOW: doors opened at NOW − 3 h,
 * passes stop at NOW + 13 h. The fake db stamps a check-in at NOW; the door
 * clock starts 5 s later.
 */
async function setup(over: Partial<EventRecord> = {}) {
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

  const events: EventRecord[] = [
    event({ startsAt: new Date(NOW.getTime() + HOUR), ...over }),
    event({ id: 'ev-2', slug: 'other', title: 'Other Night' }),
  ];
  const clock = { at: new Date(NOW.getTime() + 5_000) };
  const fake = fakeDoor(
    db,
    () => events,
    () => clock.at,
  );
  const codes = [CODE_A, CODE_B];
  const svc = createDoorService({
    door: fake.door,
    tickets: db.tickets,
    orders: fake.orders,
    events: { findById: async (id) => events.find((e) => e.id === id) ?? null },
    runInTransaction: fake.runInTransaction,
    now: () => clock.at,
    passCode: () => codes.shift() ?? 'ZZZZZZZZZZZZ',
  });
  const gateA = await svc.createPass('ev-1', 'Gate A', 'raj@example.com');
  const gateB = await svc.createPass('ev-1', 'Gate B', 'raj@example.com');
  const ctx = async (code: string): Promise<DoorContext> => {
    const c = await svc.authenticate(code);
    if (!c) throw new Error('pass not active');
    return c;
  };
  return { db, fake, svc, events, clock, order, tickets, gateA, gateB, ctx };
}

const typed = (input: string, scanId = sid()): ScanItem => ({ scanId, input, method: 'typed' });

describe('doorService.authenticate', () => {
  it('opens a pass by its code, typed any way, and knows doors are open', async () => {
    const { svc, gateA } = await setup();
    const ctx = await svc.authenticate('k7qm-4xpd r2tw');
    expect(ctx?.pass.id).toBe(gateA.id);
    expect(ctx?.practice).toBe(false);
    expect(ctx?.window.validFrom.toISOString()).toBe(
      new Date(NOW.getTime() - 3 * HOUR).toISOString(),
    );
  });

  it('refuses a wrong, revoked or expired code, and a draft event', async () => {
    const { svc, gateA, events, clock } = await setup();
    expect(await svc.authenticate('NOTACODE')).toBeNull();
    expect(await svc.authenticate('ABCDEFGHJKMN')).toBeNull();

    events[0] = { ...events[0]!, status: 'draft' };
    expect(await svc.authenticate(CODE_A)).toBeNull();
    events[0] = { ...events[0]!, status: 'published' };

    clock.at = new Date(NOW.getTime() + 13 * HOUR + 1);
    expect(await svc.authenticate(CODE_A)).toBeNull();
    clock.at = new Date(NOW.getTime() + 5_000);

    await svc.revokePass('ev-1', gateA.id, 'raj@example.com');
    expect(await svc.authenticate(CODE_A)).toBeNull();
  });

  it('keeps an archived event scanning until the window ends (issued tickets stay valid)', async () => {
    const { svc, events } = await setup();
    events[0] = { ...events[0]!, status: 'archived' };
    expect(await svc.authenticate(CODE_A)).not.toBeNull();
  });

  it('is practice before doors open, and follows an edited event date', async () => {
    const { svc, events } = await setup();
    events[0] = { ...events[0]!, startsAt: new Date(NOW.getTime() + 5 * HOUR) };
    expect((await svc.authenticate(CODE_A))?.practice).toBe(true);
    events[0] = { ...events[0]!, startsAt: new Date(NOW.getTime() - 30 * HOUR) };
    expect(await svc.authenticate(CODE_A)).toBeNull(); // moved into the past: over
  });
});

describe('doorService.scan', () => {
  it('admits a valid ticket once: checks it in, audits it, logs the scan', async () => {
    const { svc, db, fake, ctx, tickets, order } = await setup();
    const scanId = sid();
    const result = await svc.scan(
      await ctx(CODE_A),
      typed(` ${tickets[0]!.code.toLowerCase()} `, scanId),
    );

    expect(result).toMatchObject({
      scanId,
      result: 'admitted',
      practice: false,
      attendeeName: 'Nusrat Jahan',
      ticketTypeName: 'General',
      position: 1,
      total: 2,
      gate: 'Gate A',
    });
    expect(db.state.tickets[0]).toMatchObject({ checkedInBy: 'Gate A', checkedInScanId: scanId });
    const audit = db.state.events.filter(
      (e) => e.orderId === order.id && e.action === 'ticket.checked_in',
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: 'door:Gate A',
      note: `${tickets[0]!.code} · Gate A · typed`,
    });
    expect(fake.scans).toHaveLength(1);
    expect(fake.scans[0]).toMatchObject({
      result: 'admitted',
      mode: 'online',
      input: tickets[0]!.code,
    });
  });

  it('replays a retried scan id as ADMIT — never a false ALREADY IN — and records it once', async () => {
    const { svc, db, fake, ctx, tickets, clock } = await setup();
    const item = typed(tickets[0]!.code);
    const first = await svc.scan(await ctx(CODE_A), item);
    clock.at = new Date(clock.at.getTime() + 90_000); // the retry comes late
    const again = await svc.scan(await ctx(CODE_A), {
      ...item,
      input: tickets[0]!.code.toLowerCase(),
    });
    expect(first.result).toBe('admitted');
    expect(again).toMatchObject({
      result: 'admitted',
      attendeeName: 'Nusrat Jahan',
      gate: 'Gate A',
      position: first.position,
      at: first.at,
      // Marked as a replay, with its age: the door shows it amber unless
      // the Retry button sent it (a re-read could be someone else).
      replayed: true,
      secondsAgo: 95,
    });
    expect(fake.scans).toHaveLength(1);
    expect(db.state.events.filter((e) => e.action === 'ticket.checked_in')).toHaveLength(1);
  });

  it('answers scan_id_conflict when a scan id comes back with other input or from another pass', async () => {
    const { svc, ctx, tickets } = await setup();
    const item = typed(tickets[0]!.code);
    await svc.scan(await ctx(CODE_A), item);
    expect((await svc.scan(await ctx(CODE_A), { ...item, input: tickets[1]!.code })).result).toBe(
      'scan_id_conflict',
    );
    expect((await svc.scan(await ctx(CODE_B), item)).result).toBe('scan_id_conflict');
  });

  it('turns a second scan away with when and where it was first admitted', async () => {
    const { svc, ctx, tickets } = await setup();
    await svc.scan(await ctx(CODE_A), typed(tickets[0]!.code));

    const elsewhere = await svc.scan(await ctx(CODE_B), typed(tickets[0]!.code));
    expect(elsewhere).toMatchObject({
      result: 'already_in',
      gate: 'Gate A',
      byThisPass: false,
      attendeeName: 'Nusrat Jahan',
    });
    expect(elsewhere.at?.toISOString()).toBe(NOW.toISOString());

    // Same gate, seconds later: the screen shows amber "this gate, 5 s ago".
    const sameGate = await svc.scan(await ctx(CODE_A), typed(tickets[0]!.code));
    expect(sameGate).toMatchObject({ result: 'already_in', byThisPass: true, secondsAgo: 5 });
  });

  it('replays an ALREADY IN with the same stored gate and time, however late', async () => {
    const { svc, ctx, tickets, fake, clock } = await setup();
    await svc.scan(await ctx(CODE_A), typed(tickets[0]!.code));
    const item = typed(tickets[0]!.code);
    const first = await svc.scan(await ctx(CODE_B), item);
    clock.at = new Date(clock.at.getTime() + 90_000);
    const again = await svc.scan(await ctx(CODE_B), item);
    expect({ ...again, replayed: undefined }).toEqual(first);
    expect(fake.scans).toHaveLength(2);
  });

  it('never replays a green ADMIT once that admit was undone: scan again', async () => {
    const { svc, db, ctx, tickets } = await setup();
    const item = typed(tickets[0]!.code);
    await svc.scan(await ctx(CODE_A), item);
    await svc.undoOwnAdmit(await ctx(CODE_A), item.scanId, 'mis_tap');
    expect(await svc.scan(await ctx(CODE_A), item)).toEqual({
      scanId: item.scanId,
      result: 'rescan',
      practice: false,
    });
    expect(db.state.tickets[0]!.checkedInAt).toBeNull();
  });

  it('refuses a scan whose pass was revoked while it was in flight', async () => {
    const { svc, db, ctx, tickets, gateA } = await setup();
    const signedIn = await ctx(CODE_A); // authenticated before the revoke
    await svc.revokePass('ev-1', gateA.id, 'raj');
    await expect(svc.scan(signedIn, typed(tickets[0]!.code))).rejects.toBeInstanceOf(
      DoorPassRevokedError,
    );
    expect(db.state.tickets[0]!.checkedInAt).toBeNull();
  });

  it('refuses a cancelled ticket', async () => {
    const { svc, db, ctx, tickets } = await setup();
    db.state.tickets[1]!.status = 'cancelled';
    const r = await svc.scan(await ctx(CODE_A), typed(tickets[1]!.code));
    expect(r).toMatchObject({ result: 'cancelled', attendeeName: 'Tanvir Alam' });
    expect(db.state.tickets[1]!.checkedInAt).toBeNull();
  });

  it('names the other event for a ticket from another event — and no attendee', async () => {
    const { svc, db, ctx, tickets } = await setup();
    db.state.tickets[1]!.eventId = 'ev-2';
    const r = await svc.scan(await ctx(CODE_A), typed(tickets[1]!.code));
    expect(r).toEqual({
      scanId: r.scanId,
      result: 'wrong_event',
      practice: false,
      otherEventTitle: 'Other Night',
    });
  });

  it('logs junk as unparsed, never storing what the QR said', async () => {
    const { svc, fake, ctx } = await setup();
    const wifi = 'WIFI:S:Home;T:WPA;P:secret-password;;';
    expect((await svc.scan(await ctx(CODE_A), typed(wifi))).result).toBe('unknown');
    expect((await svc.scan(await ctx(CODE_A), typed('TKT-ZZZZZZZZ'))).result).toBe('unknown');
    expect(fake.scans[0]).toMatchObject({ input: `<unparsed:len=${wifi.length}>`, ticketId: null });
    expect(JSON.stringify(fake.scans)).not.toContain('secret-password');
  });

  it('in practice answers what would happen, logs it, and checks nothing in', async () => {
    const { svc, db, fake, ctx, tickets, events } = await setup();
    await svc.scan(await ctx(CODE_A), typed(tickets[1]!.code)); // Tanvir in, for real
    events[0] = { ...events[0]!, startsAt: new Date(NOW.getTime() + 5 * HOUR) };

    const would = await svc.scan(await ctx(CODE_A), typed(tickets[0]!.code));
    expect(would).toMatchObject({
      result: 'practice_ok',
      practice: true,
      attendeeName: 'Nusrat Jahan',
    });
    expect(db.state.tickets[0]!.checkedInAt).toBeNull();
    expect(fake.scans.at(-1)).toMatchObject({ mode: 'practice', result: 'practice_ok' });

    const inAlready = await svc.scan(await ctx(CODE_A), typed(tickets[1]!.code));
    expect(inAlready).toMatchObject({ result: 'already_in', practice: true, gate: 'Gate A' });
  });

  it('retries once when a concurrent undo made the ticket admissible again', async () => {
    const { svc, db, ctx, tickets } = await setup();
    vi.mocked(db.tickets.checkIn).mockResolvedValueOnce(null); // lost to an undo in flight
    const r = await svc.scan(await ctx(CODE_A), typed(tickets[0]!.code));
    expect(r.result).toBe('admitted');
    expect(db.tickets.checkIn).toHaveBeenCalledTimes(2);
  });

  it('answers a scan that raced its own retry with what the winner recorded', async () => {
    const { svc, fake, ctx, tickets } = await setup();
    const item = typed(tickets[0]!.code);
    await svc.scan(await ctx(CODE_A), item);
    // The retry arrives before the winner's log row is visible to its lookup…
    const lookup = vi.spyOn(fake.door, 'findScanByScanId').mockResolvedValueOnce(null);
    const r = await svc.scan(await ctx(CODE_A), item);
    // …its insert hits the UNIQUE scan id, rolls back, and it replays the winner.
    expect(r.result).toBe('admitted');
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(fake.scans).toHaveLength(1);
  });

  it('checks the buying phone’s last 3 digits on a name-search admit; a comp has none', async () => {
    const { svc, db, fake, ctx, tickets, order } = await setup();
    const admit = (phoneLast3?: string): ScanItem => ({
      scanId: sid(),
      ticketId: tickets[1]!.id,
      method: 'search',
      phoneLast3,
    });
    expect((await svc.scan(await ctx(CODE_A), admit())).result).toBe('phone_mismatch');
    const wrong = await svc.scan(await ctx(CODE_A), admit('123'));
    expect(wrong).toMatchObject({ result: 'phone_mismatch', attendeeName: 'Tanvir Alam' });
    expect(fake.scans.at(-1)).toMatchObject({ result: 'phone_mismatch', method: 'search' });
    expect(db.state.tickets[1]!.checkedInAt).toBeNull();
    expect((await svc.scan(await ctx(CODE_A), admit('678'))).result).toBe('admitted');

    // A comp order has no phone: nothing to check.
    db.state.orders.find((o) => o.id === order.id)!.buyerPhone = null as unknown as string;
    const comp: ScanItem = { scanId: sid(), ticketId: tickets[0]!.id, method: 'search' };
    expect((await svc.scan(await ctx(CODE_A), comp)).result).toBe('admitted');
  });

  it('admits from a name search by ticket id, and replays an unknown id as unknown', async () => {
    const { svc, fake, ctx, tickets } = await setup();
    const item: ScanItem = {
      scanId: sid(),
      ticketId: tickets[1]!.id,
      method: 'search',
      phoneLast3: '678',
    };
    expect((await svc.scan(await ctx(CODE_A), item)).result).toBe('admitted');
    expect((await svc.scan(await ctx(CODE_A), item)).result).toBe('admitted');
    expect(fake.scans[0]).toMatchObject({ method: 'search', ticketId: tickets[1]!.id });

    const ghost: ScanItem = {
      scanId: sid(),
      ticketId: '00000000-0000-4000-8000-00000000dead',
      method: 'search',
    };
    expect((await svc.scan(await ctx(CODE_A), ghost)).result).toBe('unknown');
    expect((await svc.scan(await ctx(CODE_A), ghost)).result).toBe('unknown');
  });

  it('never puts a ticket code or buyer contact details in what the door sees', async () => {
    const { svc, ctx, tickets, db } = await setup();
    const c = await ctx(CODE_A);
    db.state.tickets[1]!.eventId = 'ev-2';
    const seen = [
      await svc.scan(c, typed(tickets[0]!.code)),
      await svc.scan(c, typed(tickets[0]!.code)),
      await svc.scan(c, typed(tickets[1]!.code)),
      await svc.scan(c, typed('nonsense')),
      await svc.search(c, 'nusrat'),
      await svc.status(c),
    ];
    const json = JSON.stringify(seen);
    expect(json).not.toContain('TKT-');
    expect(json).not.toContain('nusrat@example.com');
    expect(json).not.toContain('1712345678');
    // Not even the last 3 digits: they are checked on the server, never shown.
    expect(json).not.toContain('678');
    expect(json).toContain('"phoneOnFile":true');
  });

  it('never names another event’s attendee in this gate’s recent scans', async () => {
    const { svc, db, ctx, tickets } = await setup();
    db.state.tickets[1]!.eventId = 'ev-2';
    await svc.scan(await ctx(CODE_A), typed(tickets[1]!.code));
    const [recent] = (await svc.status(await ctx(CODE_A))).recent;
    expect(recent).toMatchObject({
      result: 'wrong_event',
      attendeeName: null,
      ticketTypeName: null,
    });
  });

  it('finds a name that is also 8 letters of the code alphabet ("mahmudur")', async () => {
    const { svc, db, ctx } = await setup();
    db.state.tickets[1]!.attendeeName = 'Mahmudur Rahman';
    const hits = await svc.search(await ctx(CODE_A), 'mahmudur');
    expect(hits.map((h) => h.attendeeName)).toEqual(['Mahmudur Rahman']);
  });

  it('processes a batch one scan at a time, answering a repeated scan id once', async () => {
    const { svc, fake, ctx, tickets } = await setup();
    const item = typed(tickets[0]!.code);
    const out = await svc.scanBatch(await ctx(CODE_A), [item, item, typed(tickets[1]!.code)]);
    expect(out.map((r) => r.result)).toEqual(['admitted', 'admitted', 'admitted']);
    expect(fake.scans).toHaveLength(2);
  });
});

describe('doorService undo', () => {
  it('lets a door undo its own admit for 2 minutes, audited with the reason', async () => {
    const { svc, db, ctx, clock, tickets, order } = await setup();
    const item = typed(tickets[0]!.code);
    await svc.scan(await ctx(CODE_A), item);
    await expect(svc.undoOwnAdmit(await ctx(CODE_B), item.scanId, 'mis_tap')).rejects.toMatchObject(
      {
        reason: 'not_yours',
      },
    );

    clock.at = new Date(clock.at.getTime() + 60_000);
    await svc.undoOwnAdmit(await ctx(CODE_A), item.scanId, 'wrong_person');
    expect(db.state.tickets[0]!.checkedInAt).toBeNull();
    expect(db.state.events.at(-1)).toMatchObject({
      orderId: order.id,
      action: 'ticket.check_in_undone',
      actor: 'door:Gate A',
      note: `${tickets[0]!.code} · Wrong person`,
    });
    await expect(svc.undoOwnAdmit(await ctx(CODE_A), item.scanId, 'other')).rejects.toMatchObject({
      reason: 'not_checked_in',
    });
  });

  it('refuses a late undo, and one of a scan that was not an admit', async () => {
    const { svc, ctx, clock, tickets } = await setup();
    const item = typed(tickets[0]!.code);
    await svc.scan(await ctx(CODE_A), item);
    const second = typed(tickets[0]!.code);
    await svc.scan(await ctx(CODE_A), second); // already_in
    await expect(svc.undoOwnAdmit(await ctx(CODE_A), second.scanId, 'other')).rejects.toMatchObject(
      {
        reason: 'not_found',
      },
    );
    clock.at = new Date(clock.at.getTime() + 2 * 60_000 + 1);
    await expect(svc.undoOwnAdmit(await ctx(CODE_A), item.scanId, 'other')).rejects.toBeInstanceOf(
      CheckInUndoRefusedError,
    );
  });

  it('lets the organizer undo the check-in the page showed — only that one, on that order', async () => {
    const { svc, db, ctx, tickets, order } = await setup();
    const shown = typed(tickets[0]!.code);
    await svc.scan(await ctx(CODE_A), shown);
    const undo = (orderId: string, expectedScanId: string) =>
      svc.undoCheckInAsAdmin(tickets[0]!.id, {
        orderId,
        expectedScanId,
        reason: 'Scanned the wrong one of the group',
        actor: 'raj@example.com',
      });
    await expect(undo('order-x', shown.scanId)).rejects.toBeInstanceOf(TicketNotFoundError);
    // A stale page: the check-in it showed is not the current one.
    await expect(undo(order.id, sid())).rejects.toBeInstanceOf(CheckInUndoRefusedError);
    expect(db.state.tickets[0]!.checkedInAt).not.toBeNull(); // untouched

    const r = await undo(order.id, shown.scanId);
    expect(r.code).toBe(tickets[0]!.code);
    expect(db.state.tickets[0]!.checkedInAt).toBeNull();
    expect(db.state.events.at(-1)).toMatchObject({
      action: 'ticket.check_in_undone',
      actor: 'raj@example.com',
      // Which check-in was taken back: 16:00 Dhaka at Gate A.
      note: `${tickets[0]!.code} (in 16:00 · Gate A): Scanned the wrong one of the group`,
    });
  });

  it('revoke-and-undo stops a leaked pass and takes back every check-in it still holds', async () => {
    const { svc, db, ctx, tickets, gateA } = await setup();
    await svc.scan(await ctx(CODE_A), typed(tickets[0]!.code));
    await svc.scan(await ctx(CODE_A), typed(tickets[1]!.code));
    await expect(svc.revokeAndUndo('ev-2', gateA.id, 'leak', 'raj')).rejects.toBeInstanceOf(
      DoorPassNotFoundError,
    );

    expect(await svc.revokeAndUndo('ev-1', gateA.id, 'Posted in a group', 'raj@example.com')).toBe(
      2,
    );
    expect(db.state.tickets.every((t) => t.checkedInAt === null)).toBe(true);
    expect(db.state.events.filter((e) => e.action === 'ticket.check_in_undone')).toHaveLength(2);
    expect(await svc.authenticate(CODE_A)).toBeNull();
    // The real holders can now be scanned in at another gate.
    expect((await svc.scan(await ctx(CODE_B), typed(tickets[0]!.code))).result).toBe('admitted');
  });

  it('revoke-and-undo leaves a check-in another gate made since it read the list', async () => {
    const { svc, db, fake, ctx, tickets, gateA } = await setup();
    const byA = typed(tickets[0]!.code);
    await svc.scan(await ctx(CODE_A), byA);
    await svc.undoOwnAdmit(await ctx(CODE_A), byA.scanId, 'mis_tap');
    const byB = typed(tickets[0]!.code);
    await svc.scan(await ctx(CODE_B), byB);
    // The list was read while Gate A's check-in still stood.
    vi.spyOn(fake.door, 'ticketsCheckedInByPass').mockResolvedValueOnce([
      {
        id: tickets[0]!.id,
        code: tickets[0]!.code,
        orderId: tickets[0]!.orderId,
        checkedInScanId: byA.scanId,
      },
    ]);
    expect(await svc.revokeAndUndo('ev-1', gateA.id, 'leak', 'raj')).toBe(0);
    expect(db.state.tickets[0]).toMatchObject({
      checkedInBy: 'Gate B',
      checkedInScanId: byB.scanId,
    });
  });
});

describe('doorService passes and status', () => {
  it('makes passes only for a published event whose window has not ended', async () => {
    const { svc, events, clock } = await setup();
    events[0] = { ...events[0]!, status: 'draft' };
    await expect(svc.createPass('ev-1', 'Gate C', 'raj')).rejects.toMatchObject({
      reason: 'not_published',
    });
    events[0] = { ...events[0]!, status: 'published' };
    clock.at = new Date(NOW.getTime() + 14 * HOUR);
    await expect(svc.createPass('ev-1', 'Gate C', 'raj')).rejects.toBeInstanceOf(
      DoorPassNotAllowedError,
    );
  });

  it('retries a pass-code collision, and gives up after three', async () => {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType()] });
    const events = [event({ startsAt: new Date(NOW.getTime() + HOUR) })];
    const fake = fakeDoor(
      db,
      () => events,
      () => NOW,
    );
    const codes = [CODE_A, CODE_A, CODE_B, CODE_A, CODE_B, CODE_A];
    const svc = createDoorService({
      door: fake.door,
      tickets: db.tickets,
      orders: fake.orders,
      events: { findById: async () => events[0]! },
      runInTransaction: fake.runInTransaction,
      now: () => NOW,
      passCode: () => codes.shift()!,
    });
    await svc.createPass('ev-1', 'Gate A', 'raj');
    expect((await svc.createPass('ev-1', 'Gate B', 'raj')).code).toBe(CODE_B);
    await expect(svc.createPass('ev-1', 'Gate C', 'raj')).rejects.toBeInstanceOf(
      DoorPassCodeCollisionError,
    );
  });

  it('reports counts, this gate’s last scans, and which admits it may still undo', async () => {
    const { svc, ctx, clock, tickets, events } = await setup();
    await svc.scan(await ctx(CODE_A), typed(tickets[0]!.code));
    await svc.scan(await ctx(CODE_A), typed('junk'));
    const status = await svc.status(await ctx(CODE_A));
    expect(status).toMatchObject({ issued: 2, checkedIn: 1, practice: false });
    expect(status.recent.map((r) => [r.result, r.attendeeName, r.undoable])).toEqual([
      ['unknown', null, false],
      ['admitted', 'Nusrat Jahan', true],
    ]);
    clock.at = new Date(clock.at.getTime() + 3 * 60_000);
    expect((await svc.status(await ctx(CODE_A))).recent[1]!.undoable).toBe(false);

    const rows = await svc.listPasses(events[0]!);
    expect(rows.map((r) => [r.pass.label, r.state, r.scans, r.admitted])).toEqual([
      ['Gate A', 'active', 2, 1],
      ['Gate B', 'active', 0, 0],
    ]);
    // Unpublished: every pass is refused, and the card says so.
    const draft = await svc.listPasses({ ...events[0]!, status: 'draft' });
    expect(draft.map((r) => r.state)).toEqual(['paused', 'paused']);
  });
});

describe('doorService offline sync (ADR-034)', () => {
  const MIN = 60_000;
  const offline = (
    input: string,
    verdict: 'admitted' | 'refused' | 'practice' | 'undone',
    scannedAt: Date,
    over: Partial<ScanItem> = {},
  ): ScanItem => ({
    scanId: sid(),
    input,
    method: 'qr',
    scannedAt,
    offline: { verdict },
    ...over,
  });

  it('replays an offline ADMIT as a check-in, dated when the door admitted, audited as offline', async () => {
    const { svc, db, fake, ctx, tickets, order, clock } = await setup();
    const at = new Date(clock.at.getTime() - 20 * MIN);
    const r = await svc.scan(await ctx(CODE_B), offline(tickets[0]!.code, 'admitted', at));

    expect(r).toMatchObject({ result: 'admitted', gate: 'Gate B', attendeeName: 'Nusrat Jahan' });
    expect(db.state.tickets[0]).toMatchObject({ checkedInAt: at, checkedInBy: 'Gate B' });
    expect(fake.scans.at(-1)).toMatchObject({
      mode: 'offline',
      doorVerdict: 'admitted',
      result: 'admitted',
      scannedAt: at,
    });
    const audit = db.state.events.filter(
      (e) => e.orderId === order.id && e.action === 'ticket.checked_in',
    );
    expect(audit.at(-1)?.note).toBe(`${tickets[0]!.code} · Gate B · qr · offline`);
  });

  it('clamps a wrong phone clock: never before doors opened, never in the future', async () => {
    const { svc, db, ctx, tickets, clock } = await setup();
    await svc.scan(
      await ctx(CODE_A),
      offline(tickets[0]!.code, 'admitted', new Date(clock.at.getTime() + 2 * HOUR)),
    );
    expect(db.state.tickets[0]!.checkedInAt).toEqual(clock.at);

    await svc.scan(
      await ctx(CODE_A),
      offline(tickets[1]!.code, 'admitted', new Date(NOW.getTime() - 10 * HOUR)),
    );
    // Doors opened at NOW − 3 h (the event starts an hour after NOW).
    expect(db.state.tickets[1]!.checkedInAt).toEqual(new Date(NOW.getTime() - 3 * HOUR));
  });

  it('stores the clamped time on the scan, so a future phone clock cannot hold the undo open', async () => {
    const { svc, fake, ctx, tickets, clock } = await setup();
    const item = offline(tickets[0]!.code, 'admitted', new Date(clock.at.getTime() + 10 * HOUR));
    await svc.scan(await ctx(CODE_A), item);
    expect(fake.scans.at(-1)!.scannedAt).toEqual(clock.at);

    clock.at = new Date(clock.at.getTime() + 3 * MIN);
    await expect(svc.undoOwnAdmit(await ctx(CODE_A), item.scanId, 'mis_tap')).rejects.toThrow(
      CheckInUndoRefusedError,
    );
    const status = await svc.status(await ctx(CODE_A));
    expect(status.recent[0]!.undoable).toBe(false);
  });

  it('never replays an ADMIT to a re-sent scan whose verdict changed (a lost undo is loud)', async () => {
    const { svc, db, ctx, tickets, clock } = await setup();
    const item = offline(tickets[0]!.code, 'admitted', clock.at);
    await svc.scan(await ctx(CODE_A), item);
    const resent = await svc.scan(await ctx(CODE_A), {
      ...item,
      offline: { verdict: 'undone' },
    });
    expect(resent.result).toBe('scan_id_conflict');
    // The ADMIT stands: the phone must take it back with the online undo.
    expect(db.state.tickets[0]!.checkedInScanId).toBe(item.scanId);
  });

  it('records a double entry when the ticket was already in: nothing checked in twice', async () => {
    const { svc, db, ctx, tickets, clock } = await setup();
    await svc.scan(await ctx(CODE_A), typed(tickets[0]!.code)); // Gate A, online
    const firstIn = db.state.tickets[0]!.checkedInAt;
    const offlineAt = new Date(clock.at.getTime() - 5 * MIN);

    const r = await svc.scan(await ctx(CODE_B), offline(tickets[0]!.code, 'admitted', offlineAt));
    expect(r).toMatchObject({ result: 'already_in', gate: 'Gate A' });
    expect(db.state.tickets[0]).toMatchObject({ checkedInAt: firstIn, checkedInBy: 'Gate A' });

    const conflicts = await svc.offlineConflicts('ev-1');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      gate: 'Gate B',
      result: 'already_in',
      admittedAt: offlineAt,
      attendeeName: 'Nusrat Jahan',
      priorGate: 'Gate A',
      priorAt: firstIn,
    });
  });

  it('records a double entry for a ticket cancelled after the list was downloaded', async () => {
    const { svc, db, ctx, tickets, clock } = await setup();
    db.state.tickets[0]!.status = 'cancelled';
    const r = await svc.scan(await ctx(CODE_B), offline(tickets[0]!.code, 'admitted', clock.at));
    expect(r.result).toBe('cancelled');
    expect(db.state.tickets[0]!.checkedInAt).toBeNull();
    expect((await svc.offlineConflicts('ev-1')).map((c) => c.result)).toEqual(['cancelled']);
  });

  it('never checks in a scan the offline door turned away or undid — it only logs it', async () => {
    const { svc, db, fake, ctx, tickets, clock } = await setup();
    const refused = await svc.scan(
      await ctx(CODE_A),
      offline(tickets[0]!.code, 'refused', clock.at),
    );
    const undone = await svc.scan(await ctx(CODE_A), offline(tickets[1]!.code, 'undone', clock.at));
    expect([refused.result, undone.result]).toEqual(['turned_away', 'turned_away']);
    expect(db.state.tickets.map((t) => t.checkedInAt)).toEqual([null, null]);
    expect(fake.scans.map((s) => [s.mode, s.doorVerdict])).toEqual([
      ['offline', 'refused'],
      ['offline', 'undone'],
    ]);
    // Turned away is not a double entry: nobody walked in.
    expect(await svc.offlineConflicts('ev-1')).toEqual([]);

    // Turned away because this phone's list knew it was in: the log says so.
    await svc.scan(await ctx(CODE_B), typed(tickets[0]!.code));
    const again = await svc.scan(await ctx(CODE_A), offline(tickets[0]!.code, 'refused', clock.at));
    expect(again).toMatchObject({ result: 'already_in', gate: 'Gate B' });
  });

  it('keeps an offline PRACTICE answer practice, and never checks in while doors are shut', async () => {
    const { svc, db, fake, ctx, tickets, events, clock } = await setup();
    const p = await svc.scan(await ctx(CODE_A), offline(tickets[0]!.code, 'practice', clock.at));
    expect(p).toMatchObject({ result: 'practice_ok', practice: true });
    expect(fake.scans.at(-1)).toMatchObject({ mode: 'offline', doorVerdict: 'practice' });

    // The phone's clock said doors were open; the server's says not yet.
    events[0] = { ...events[0]!, startsAt: new Date(NOW.getTime() + 5 * HOUR) };
    const early = await svc.scan(
      await ctx(CODE_A),
      offline(tickets[1]!.code, 'admitted', clock.at),
    );
    expect(early.result).toBe('practice_ok');
    expect(db.state.tickets.map((t) => t.checkedInAt)).toEqual([null, null]);
  });

  it('is not a double entry when the online request it replaced did admit (the answer was lost)', async () => {
    const { svc, ctx, tickets, clock } = await setup();
    const lost = sid();
    // The live request landed, but the phone never heard back…
    await svc.scan(await ctx(CODE_A), typed(tickets[0]!.code, lost));
    // …so it answered offline and later syncs that, naming the lost request.
    const r = await svc.scan(
      await ctx(CODE_A),
      offline(tickets[0]!.code, 'admitted', clock.at, {
        offline: { verdict: 'admitted', supersedesScanId: lost },
      }),
    );
    expect(r).toMatchObject({ result: 'already_in', byThisPass: true });
    expect(await svc.offlineConflicts('ev-1')).toEqual([]);
  });

  it('answers a re-sent sync the same way, and records it once', async () => {
    const { svc, fake, ctx, tickets, clock } = await setup();
    const item = offline(tickets[0]!.code, 'admitted', clock.at);
    const [first, second] = await svc.scanBatch(await ctx(CODE_A), [item, item]);
    const resent = await svc.scan(await ctx(CODE_A), item);
    expect(first?.result).toBe('admitted');
    expect(second).toEqual(first);
    expect(resent).toMatchObject({ result: 'admitted', replayed: true });
    expect(fake.scans).toHaveLength(1);
  });

  it('times the door’s own undo from when it admitted offline, not from the sync', async () => {
    const { svc, ctx, tickets, clock } = await setup();
    const item = offline(tickets[0]!.code, 'admitted', new Date(clock.at.getTime() - 5 * MIN));
    await svc.scan(await ctx(CODE_A), item);
    await expect(svc.undoOwnAdmit(await ctx(CODE_A), item.scanId, 'mis_tap')).rejects.toThrow(
      CheckInUndoRefusedError,
    );
    const status = await svc.status(await ctx(CODE_A));
    expect(status.recent[0]).toMatchObject({ undoable: false, at: item.scannedAt });
    expect(status.serverTime).toEqual(clock.at);
  });

  it('counts each gate’s offline scans for the organizer', async () => {
    const { svc, ctx, tickets, events, clock } = await setup();
    await svc.scan(await ctx(CODE_A), typed(tickets[0]!.code));
    await svc.scan(await ctx(CODE_B), offline(tickets[1]!.code, 'admitted', clock.at));
    const rows = await svc.listPasses(events[0]!);
    expect(rows.map((r) => [r.pass.label, r.scans, r.offlineScans])).toEqual([
      ['Gate A', 1, 0],
      ['Gate B', 1, 1],
    ]);
  });
});

describe('doorService.offlineList (ADR-034)', () => {
  it('lists the event’s tickets with hashed codes, check-ins, and no buyer details', async () => {
    const { svc, ctx, tickets, clock } = await setup();
    await svc.scan(await ctx(CODE_A), typed(tickets[1]!.code));
    const list = await svc.offlineList(await ctx(CODE_B));

    expect(list).toMatchObject({
      v: 1,
      eventId: 'ev-1',
      serverTime: clock.at.toISOString(),
      validFrom: new Date(NOW.getTime() - 3 * HOUR).toISOString(),
    });
    expect(list.entries.map((e) => [e.name, e.pos, e.of, e.status, e.inBy])).toEqual([
      ['Nusrat Jahan', 1, 2, 'issued', null],
      ['Tanvir Alam', 2, 2, 'issued', 'Gate A'],
    ]);
    const { offlineDigest } = await import('@/server/lib/door-offline');
    expect(list.entries[0]!.d).toBe(await offlineDigest(list.salt, tickets[0]!.code));

    const json = JSON.stringify(list);
    expect(json).not.toContain('TKT-');
    expect(json).not.toContain('8801712345678');
    expect(json).not.toContain('nusrat@example.com');
  });

  it('stamps the list as of BEFORE its read, never after', async () => {
    const { svc, fake, ctx, clock } = await setup();
    const before = clock.at;
    const read = fake.door.offlineList;
    fake.door.offlineList = async (eventId) => {
      // A slow read: the clock moves on while it runs.
      clock.at = new Date(clock.at.getTime() + 30_000);
      return read(eventId);
    };
    const list = await svc.offlineList(await ctx(CODE_A));
    expect(list.serverTime).toBe(before.toISOString());
  });

  it('salts every download afresh, so two lists never share a hash', async () => {
    const { svc, ctx } = await setup();
    const a = await svc.offlineList(await ctx(CODE_A));
    const b = await svc.offlineList(await ctx(CODE_A));
    expect(a.salt).not.toBe(b.salt);
    expect(a.entries[0]!.d).not.toBe(b.entries[0]!.d);
  });
});
