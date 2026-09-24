import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import { findPostgresError } from '@/server/lib/pg-errors';
import { DoorPassRevokedError, TicketCheckedInError } from '@/server/lib/errors';
import { doorRepository } from '@/server/repositories/door.repository';
import { eventsRepository } from '@/server/repositories/events.repository';
import { inventoryRepository } from '@/server/repositories/inventory.repository';
import { ordersRepository } from '@/server/repositories/orders.repository';
import { ticketTypesRepository } from '@/server/repositories/ticket-types.repository';
import { ticketsRepository } from '@/server/repositories/tickets.repository';
import {
  type DoorContext,
  type ScanResult,
  createDoorService,
} from '@/server/services/door.service';
import { createFulfilmentService } from '@/server/services/fulfilment.service';
import { createInventoryService } from '@/server/services/inventory.service';

/**
 * ADR-030 gate check-in against real Postgres. The key test: twelve
 * phones scanning one ticket at once — exactly one admits, the rest are
 * told ALREADY IN, and the run finishes (every statement inside a scan
 * transaction is bound to it, so twelve scans on a 10-connection pool
 * cannot starve it). Plus a same-scan-id race, check-in racing cancel,
 * and the CHECK constraints as the backstop.
 */
describe('doorService (Postgres)', () => {
  const eventId = randomUUID();
  const typeId = randomUUID();
  const orderId = randomUUID();
  const ACTOR = 'raj@example.com';
  // Codes from the unambiguous alphabet: a 4-char tag keeps runs apart.
  const tag = randomUUID()
    .replace(/[^a-hj-km-np-z2-9]/gi, '')
    .slice(0, 4)
    .toUpperCase()
    .padEnd(4, 'X');
  const names = [
    'Rush Hour',
    'Twin Scan',
    'Race Cancel',
    'Leaked Pass',
    'Check Backstop',
    // 8 letters of the code alphabet: also parses as a ticket code.
    'Mahmudur Search',
    'Revoke Race',
  ];
  // Letters from the ticket alphabet only (no I, L, O, 0, 1) — anything
  // else is, correctly, NOT A VALID TICKET to the scanner.
  const codes = ['RUSH', 'TWNS', 'RACE', 'PASS', 'CHCK', 'NAME', 'RVKE'].map(
    (c) => `TKT-${c}${tag}`,
  );
  // Another event with one ticket, for the wrong-event scan.
  const otherEventId = randomUUID();
  const otherTypeId = randomUUID();
  const otherOrderId = randomUUID();
  const otherCode = `TKT-THER${tag}`;
  const ticketIds = names.map(() => randomUUID());

  const door = createDoorService({
    door: doorRepository,
    tickets: ticketsRepository,
    orders: ordersRepository,
    events: eventsRepository,
    runInTransaction: (fn) => db.transaction(fn),
  });
  const fulfilment = createFulfilmentService({
    orders: ordersRepository,
    tickets: ticketsRepository,
    ticketTypes: ticketTypesRepository,
    inventory: createInventoryService(inventoryRepository),
    runInTransaction: (fn) => db.transaction(fn),
    onTicketsIssued: async () => {},
  });
  let gateA: DoorContext;
  let gateB: DoorContext;

  const scan = (ctx: DoorContext, input: string, scanId = randomUUID()) =>
    door.scan(ctx, { scanId, input, method: 'qr' });
  const ticketRow = async (i: number) => {
    const [row] = await db
      .select()
      .from(schema.tickets)
      .where(eq(schema.tickets.id, ticketIds[i]!));
    return row!;
  };

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    // Starts in an hour: doors opened three hours ago, so scans are real.
    await db.insert(schema.events).values({
      id: eventId,
      slug: `door-${eventId}`,
      title: 'Door Night',
      startsAt: new Date(Date.now() + 60 * 60_000),
      registrationOpensAt: new Date(Date.now() - 20 * 24 * 60 * 60_000),
      registrationClosesAt: new Date(Date.now() - 24 * 60 * 60_000),
      status: 'published',
    });
    await db.insert(schema.ticketTypes).values({
      id: typeId,
      eventId,
      name: 'General',
      pricePaisa: 120_000,
      quantityTotal: 100,
      quantitySold: names.length,
    });
    await db.insert(schema.orders).values({
      id: orderId,
      eventId,
      ticketTypeId: typeId,
      reference: `EA-DR${tag}`.slice(0, 9),
      quantity: names.length,
      unitPricePaisa: 120_000,
      subtotalPaisa: 120_000 * names.length,
      totalPaisa: 120_000 * names.length,
      buyerName: 'Door Test',
      buyerEmail: `door.${orderId}@example.com`,
      buyerPhone: '+8801712345678',
      status: 'issued',
    });
    await db.insert(schema.tickets).values(
      names.map((attendeeName, i) => ({
        id: ticketIds[i]!,
        orderId,
        eventId,
        ticketTypeId: typeId,
        position: i + 1,
        attendeeName,
        code: codes[i]!,
      })),
    );
    await db.insert(schema.events).values({
      id: otherEventId,
      slug: `door-other-${otherEventId}`,
      title: 'Other Night',
      startsAt: new Date(Date.now() + 5 * 24 * 60 * 60_000),
      registrationOpensAt: new Date(Date.now() - 20 * 24 * 60 * 60_000),
      registrationClosesAt: new Date(Date.now() + 24 * 60 * 60_000),
      status: 'published',
    });
    await db.insert(schema.ticketTypes).values({
      id: otherTypeId,
      eventId: otherEventId,
      name: 'Secret VIP',
      pricePaisa: 120_000,
      quantityTotal: 10,
      quantitySold: 1,
    });
    await db.insert(schema.orders).values({
      id: otherOrderId,
      eventId: otherEventId,
      ticketTypeId: otherTypeId,
      reference: `EA-DO${tag}`.slice(0, 9),
      quantity: 1,
      unitPricePaisa: 120_000,
      subtotalPaisa: 120_000,
      totalPaisa: 120_000,
      buyerName: 'Other Buyer',
      buyerEmail: `other.${otherOrderId}@example.com`,
      buyerPhone: '+8801812345999',
      status: 'issued',
    });
    await db.insert(schema.tickets).values({
      orderId: otherOrderId,
      eventId: otherEventId,
      ticketTypeId: otherTypeId,
      position: 1,
      attendeeName: 'Somebody Private',
      code: otherCode,
    });
    const a = await door.createPass(eventId, 'Gate A', ACTOR);
    const b = await door.createPass(eventId, 'Gate B', ACTOR);
    gateA = (await door.authenticate(a.code))!;
    gateB = (await door.authenticate(b.code))!;
    expect(gateA.practice).toBe(false);
  });

  afterAll(async () => {
    // Every door foreign key is RESTRICT: the log goes first, then the passes.
    await db.delete(schema.doorScans).where(eq(schema.doorScans.eventId, eventId));
    await db.delete(schema.doorPasses).where(eq(schema.doorPasses.eventId, eventId));
    await db.delete(schema.orders).where(eq(schema.orders.id, orderId)); // tickets, audit cascade
    await db.delete(schema.ticketTypes).where(eq(schema.ticketTypes.eventId, eventId));
    await db.delete(schema.events).where(eq(schema.events.id, eventId));
    await db.delete(schema.orders).where(eq(schema.orders.id, otherOrderId));
    await db.delete(schema.ticketTypes).where(eq(schema.ticketTypes.eventId, otherEventId));
    await db.delete(schema.events).where(eq(schema.events.id, otherEventId));
    await queryClient.end();
  });

  it('twelve simultaneous scans of one ticket: exactly one admits, eleven are ALREADY IN', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => scan(i % 2 ? gateB : gateA, codes[0]!)),
    );
    const admitted = results.filter((r) => r.result === 'admitted');
    expect(admitted).toHaveLength(1);
    expect(results.filter((r) => r.result === 'already_in')).toHaveLength(11);
    // Every refusal names the winner's gate and time.
    const winner = admitted[0]!;
    for (const r of results.filter((x) => x.result === 'already_in')) {
      expect(r.gate).toBe(winner.gate);
      expect(r.at?.getTime()).toBe(winner.at?.getTime());
    }

    const t = await ticketRow(0);
    expect(t.checkedInScanId).toBe(winner.scanId);
    const logged = await db
      .select()
      .from(schema.doorScans)
      .where(eq(schema.doorScans.ticketId, ticketIds[0]!));
    expect(logged).toHaveLength(12);
    const audit = await db
      .select()
      .from(schema.orderEvents)
      .where(
        and(
          eq(schema.orderEvents.orderId, orderId),
          eq(schema.orderEvents.action, 'ticket.checked_in'),
          sql`${schema.orderEvents.note} LIKE ${`${codes[0]} %`}`,
        ),
      );
    expect(audit).toHaveLength(1);
  }, 30_000);

  it('the same scan id sent twice at once is logged once and answers ADMIT both times', async () => {
    const scanId = randomUUID();
    const [a, b] = await Promise.all([
      scan(gateA, codes[1]!, scanId),
      scan(gateA, codes[1]!, scanId),
    ]);
    expect([a!.result, b!.result]).toEqual(['admitted', 'admitted']);
    const logged = await db
      .select()
      .from(schema.doorScans)
      .where(eq(schema.doorScans.scanId, scanId));
    expect(logged).toHaveLength(1);
  });

  it('a check-in racing a cancel: exactly one wins, and the ticket is never both', async () => {
    const [scanned, cancelled] = await Promise.allSettled([
      scan(gateA, codes[2]!),
      fulfilment.cancelTicket(ticketIds[2]!, { orderId, actor: ACTOR, reason: 'Race test' }),
    ]);
    const t = await ticketRow(2);
    if (t.status === 'cancelled') {
      expect(cancelled.status).toBe('fulfilled');
      expect(scanned.status === 'fulfilled' && (scanned.value as ScanResult).result).toBe(
        'cancelled',
      );
      expect(t.checkedInAt).toBeNull();
    } else {
      expect(scanned.status === 'fulfilled' && (scanned.value as ScanResult).result).toBe(
        'admitted',
      );
      expect(cancelled.status).toBe('rejected');
      // Cancel locks the ticket before it looks, so it always sees the
      // check-in: only the "admitted — undo it first" refusal is right.
      const reason = cancelled.status === 'rejected' ? (cancelled.reason as unknown) : null;
      expect(reason).toBeInstanceOf(TicketCheckedInError);
      expect(reason).toMatchObject({ checkedInBy: 'Gate A' });
      expect(t.checkedInAt).not.toBeNull();
    }
  });

  it('revoke-and-undo finds the pass’s standing check-ins through the scan log', async () => {
    const leaked = await door.createPass(eventId, 'Gate L', ACTOR);
    const ctx = (await door.authenticate(leaked.code))!;
    expect((await scan(ctx, codes[3]!)).result).toBe('admitted');
    expect(await door.revokeAndUndo(eventId, leaked.id, 'Posted in a group', ACTOR)).toBe(1);
    expect((await ticketRow(3)).checkedInAt).toBeNull();
    expect(await door.authenticate(leaked.code)).toBeNull();
    expect((await scan(gateA, codes[3]!)).result).toBe('admitted');
  });

  it('the CHECK constraints refuse a half-set check-in and cancelling a checked-in ticket', async () => {
    const violation = async (statement: Promise<unknown>) =>
      findPostgresError(
        await statement.then(
          () => null,
          (e: unknown) => e,
        ),
      )?.constraint_name;

    expect(
      await violation(
        db.execute(sql`UPDATE tickets SET checked_in_at = now() WHERE id = ${ticketIds[4]!}`),
      ),
    ).toBe('tickets_check_in_consistent');

    expect((await scan(gateA, codes[4]!)).result).toBe('admitted');
    expect(
      await violation(
        db.execute(sql`UPDATE tickets SET status = 'cancelled' WHERE id = ${ticketIds[4]!}`),
      ),
    ).toBe('tickets_checked_in_is_issued');
    // And the repository's own cancel simply does not match a checked-in ticket.
    expect(await ticketsRepository.cancel(ticketIds[4]!)).toBeNull();
  });

  it('a revoke racing in-flight scans never leaves a check-in by the revoked pass', async () => {
    for (let round = 0; round < 5; round++) {
      const pass = await door.createPass(eventId, `Gate R${round}`, ACTOR);
      const ctx = (await door.authenticate(pass.code))!;
      const [scanned] = await Promise.allSettled([
        scan(ctx, codes[6]!),
        door.revokeAndUndo(eventId, pass.id, 'race', ACTOR),
      ]);
      // Either the scan got in first and was undone, or it saw the revoke.
      if (scanned.status === 'rejected') {
        expect(scanned.reason).toBeInstanceOf(DoorPassRevokedError);
      }
      const t = await ticketRow(6);
      expect(t.checkedInAt).toBeNull();
    }
  });

  it('never names another event’s attendee, on the answer or in the recent scans', async () => {
    const r = await scan(gateA, otherCode);
    expect(r).toMatchObject({ result: 'wrong_event', otherEventTitle: 'Other Night' });
    expect(r.attendeeName).toBeUndefined();
    const [latest] = (await door.status(gateA)).recent;
    expect(latest).toMatchObject({
      result: 'wrong_event',
      attendeeName: null,
      ticketTypeName: null,
    });
  });

  it('searches by name (even one that parses as a code) and checks phone digits server-side', async () => {
    const hits = await door.search(gateA, 'mahmudur');
    expect(hits).toEqual([
      expect.objectContaining({
        ticketId: ticketIds[5],
        attendeeName: 'Mahmudur Search',
        phoneOnFile: true,
      }),
    ]);
    const json = JSON.stringify(hits);
    expect(json).not.toContain('TKT-');
    expect(json).not.toContain('678');
    const admit = (phoneLast3: string) =>
      door.scan(gateA, {
        scanId: randomUUID(),
        ticketId: ticketIds[5]!,
        method: 'search',
        phoneLast3,
      });
    expect((await admit('111')).result).toBe('phone_mismatch');
    expect((await ticketRow(5)).checkedInAt).toBeNull();
    expect((await admit('678')).result).toBe('admitted');
    expect(await door.search(gateA, '%%')).toEqual([]);
    expect(await door.search(gateA, '__')).toEqual([]);
    expect((await door.search(gateA, codes[5]!.toLowerCase())).map((h) => h.ticketId)).toEqual([
      ticketIds[5],
    ]);
  });

  it('status counts the event and lists this gate’s scans, newest first', async () => {
    const status = await door.status(gateB);
    const checkedIn = await db
      .select({ id: schema.tickets.id })
      .from(schema.tickets)
      .where(
        and(inArray(schema.tickets.id, ticketIds), sql`${schema.tickets.checkedInAt} IS NOT NULL`),
      );
    const cancelledNow = (await ticketRow(2)).status === 'cancelled' ? 1 : 0;
    expect(status.issued).toBe(names.length - cancelledNow);
    expect(status.checkedIn).toBe(checkedIn.length);
    expect(status.recent.length).toBeGreaterThan(0);
    const times = status.recent.map((r) => r.at.getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);

    const passes = await door.listPasses((await eventsRepository.findById(eventId))!);
    expect(passes.find((p) => p.pass.label === 'Gate L')?.state).toBe('revoked');
  });
});
