import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import { ticketsRepository } from '@/server/repositories/tickets.repository';

/**
 * B11 door list against real Postgres: the join brings the right order
 * reference and ticket-type name for each ticket, only this event's tickets
 * come back (all statuses — the service decides what to list), and the
 * default order is attendee name then code.
 */
describe('ticketsRepository.listForEvent (Postgres)', () => {
  const eventA = randomUUID();
  const eventB = randomUUID();
  const ttGeneral = randomUUID();
  const ttVip = randomUUID();
  const ttB = randomUUID();
  const orderA1 = randomUUID();
  const orderA2 = randomUUID();
  const orderB = randomUUID();
  // Six unambiguous characters per reference; codes below likewise.
  const tag = randomUUID()
    .replace(/[^a-hj-km-np-z2-9]/gi, '')
    .slice(0, 4)
    .toUpperCase()
    .padEnd(4, 'X');

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.events).values(
      [
        [eventA, 'Check-in A'],
        [eventB, 'Check-in B'],
      ].map(([id, title]) => ({
        id: id!,
        slug: `checkin-${id}`,
        title: title!,
        startsAt: new Date('2026-10-01T13:00:00Z'),
        registrationOpensAt: new Date('2026-09-11T13:00:00Z'),
        registrationClosesAt: new Date('2026-09-26T13:00:00Z'),
        status: 'published' as const,
      })),
    );
    await db.insert(schema.ticketTypes).values([
      { id: ttGeneral, eventId: eventA, name: 'General', pricePaisa: 120_000, quantityTotal: 100 },
      { id: ttVip, eventId: eventA, name: 'VIP', pricePaisa: 350_000, quantityTotal: 100 },
      { id: ttB, eventId: eventB, name: 'Other', pricePaisa: 100_000, quantityTotal: 100 },
    ]);
    const order = (id: string, eventId: string, ticketTypeId: string, ref: string) => ({
      id,
      eventId,
      ticketTypeId,
      reference: `EA-${ref}${tag}`.slice(0, 9),
      quantity: 2,
      unitPricePaisa: 120_000,
      subtotalPaisa: 240_000,
      totalPaisa: 240_000,
      buyerName: 'Door Test',
      buyerEmail: `door.${id}@example.com`,
      buyerPhone: '+8801712345678',
      status: 'issued' as const,
    });
    await db
      .insert(schema.orders)
      .values([
        order(orderA1, eventA, ttGeneral, 'CA'),
        order(orderA2, eventA, ttVip, 'CB'),
        order(orderB, eventB, ttB, 'CC'),
      ]);
    const ticket = (
      orderId: string,
      eventId: string,
      ticketTypeId: string,
      position: number,
      attendeeName: string,
      code: string,
      status: 'issued' | 'cancelled' = 'issued',
    ) => ({
      orderId,
      eventId,
      ticketTypeId,
      position,
      attendeeName,
      code: `TKT-${code}${tag}`,
      status,
    });
    await db
      .insert(schema.tickets)
      .values([
        ticket(orderA1, eventA, ttGeneral, 1, 'Nusrat Jahan', 'NUSA'),
        ticket(orderA1, eventA, ttGeneral, 2, 'Tanvir Alam', 'TANV'),
        ticket(orderA2, eventA, ttVip, 1, 'Farhana Rahman', 'FARH'),
        ticket(orderA2, eventA, ttVip, 2, 'Farhana Rahman', 'FARB', 'cancelled'),
        ticket(orderB, eventB, ttB, 1, 'Someone Else', 'ELSE'),
      ]);
  });

  afterAll(async () => {
    for (const id of [orderA1, orderA2, orderB]) {
      await db.delete(schema.orders).where(eq(schema.orders.id, id)); // tickets cascade
    }
    for (const id of [eventA, eventB]) {
      await db.delete(schema.ticketTypes).where(eq(schema.ticketTypes.eventId, id));
      await db.delete(schema.events).where(eq(schema.events.id, id));
    }
    await queryClient.end();
  });

  it('joins reference and type name, scopes to the event, keeps every status, orders by name then code', async () => {
    const rows = await ticketsRepository.listForEvent(eventA);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.ticket.attendeeName)).toEqual([
      'Farhana Rahman',
      'Farhana Rahman',
      'Nusrat Jahan',
      'Tanvir Alam',
    ]);
    // Same name → code decides: FARB… < FARH….
    expect(rows[0]!.ticket.code.startsWith('TKT-FARB')).toBe(true);
    expect(rows[0]!.ticket.status).toBe('cancelled');
    expect(rows[0]).toMatchObject({ ticketTypeName: 'VIP', orderReference: `EA-CB${tag}` });
    expect(rows[2]).toMatchObject({ ticketTypeName: 'General', orderReference: `EA-CA${tag}` });
    expect(rows.some((r) => r.ticket.eventId !== eventA)).toBe(false);
  });

  it('is empty for an unknown event id', async () => {
    expect(await ticketsRepository.listForEvent(randomUUID())).toEqual([]);
  });
});
