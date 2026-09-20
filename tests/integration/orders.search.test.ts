import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import { ordersRepository } from '@/server/repositories/orders.repository';
import { normaliseSearchTerm } from '@/lib/validation/orders-search';

/**
 * B9 search against real Postgres: the ORed identifier equality, the
 * ILIKE on email (with wildcard escaping), the ANDed filters, the date
 * bounds, and pagination with a total — the parts the fake repo mirrors
 * but cannot prove.
 */
describe('ordersRepository.search (Postgres)', () => {
  const eventA = randomUUID();
  const eventB = randomUUID();
  const ttA = randomUUID();
  const ttB = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const ids: string[] = [];

  async function order(input: {
    eventId: string;
    ticketTypeId: string;
    reference: string;
    email: string;
    phone: string;
    trxId?: string;
    status?: (typeof schema.orders.$inferInsert)['status'];
    createdAt: Date;
  }) {
    const id = randomUUID();
    ids.push(id);
    await db.insert(schema.orders).values({
      id,
      eventId: input.eventId,
      ticketTypeId: input.ticketTypeId,
      reference: input.reference,
      quantity: 1,
      unitPricePaisa: 120_000,
      subtotalPaisa: 120_000,
      totalPaisa: 120_000,
      buyerName: 'Search Test',
      buyerEmail: input.email,
      buyerPhone: input.phone,
      bkashTrxId: input.trxId ?? null,
      status: input.status ?? 'pending_payment',
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
    return id;
  }

  let a1: string, a2: string, b1: string, b2: string;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    for (const [id, name] of [
      [eventA, 'Search A'],
      [eventB, 'Search B'],
    ] as const) {
      await db.insert(schema.events).values({
        id,
        slug: `search-${id}`,
        title: name,
        startsAt: new Date('2026-10-01T13:00:00Z'),
        registrationOpensAt: new Date('2026-09-11T13:00:00Z'),
        registrationClosesAt: new Date('2026-09-26T13:00:00Z'),
        status: 'published',
      });
    }
    await db.insert(schema.ticketTypes).values([
      { id: ttA, eventId: eventA, name: 'General', pricePaisa: 120_000, quantityTotal: 100 },
      { id: ttB, eventId: eventB, name: 'VIP', pricePaisa: 350_000, quantityTotal: 100 },
    ]);
    // Dhaka 2026-09-15 23:30 = 17:30Z; Dhaka 2026-09-16 00:30 = 18:30Z the same UTC day.
    a1 = await order({
      eventId: eventA,
      ticketTypeId: ttA,
      reference: `EA-S${tag
        .slice(0, 5)
        .toUpperCase()
        .replace(/[^A-Z2-9]/g, 'X')}`,
      email: `nusrat.${tag}@example.com`,
      phone: '+8801712345678',
      trxId: `TX${tag.toUpperCase()}`,
      status: 'pending_verification',
      createdAt: new Date('2026-09-15T17:30:00Z'),
    });
    a2 = await order({
      eventId: eventA,
      ticketTypeId: ttA,
      reference: `EA-T${tag
        .slice(0, 5)
        .toUpperCase()
        .replace(/[^A-Z2-9]/g, 'X')}`,
      email: `tanvir_${tag}@example.com`,
      phone: '+8801912345678',
      status: 'issued',
      createdAt: new Date('2026-09-15T18:30:00Z'),
    });
    b1 = await order({
      eventId: eventB,
      ticketTypeId: ttB,
      reference: `EA-U${tag
        .slice(0, 5)
        .toUpperCase()
        .replace(/[^A-Z2-9]/g, 'X')}`,
      email: `farhana.${tag}@example.com`,
      phone: '+8801812345678',
      status: 'expired',
      createdAt: new Date('2026-09-17T03:00:00Z'),
    });
    b2 = await order({
      eventId: eventB,
      ticketTypeId: ttB,
      reference: `EA-V${tag
        .slice(0, 5)
        .toUpperCase()
        .replace(/[^A-Z2-9]/g, 'X')}`,
      email: `100%_${tag}@example.com`,
      phone: '+8801612345678',
      createdAt: new Date('2026-09-18T03:00:00Z'),
    });
  });

  afterAll(async () => {
    for (const id of ids) await db.delete(schema.orders).where(eq(schema.orders.id, id));
    await db.delete(schema.ticketTypes).where(eq(schema.ticketTypes.eventId, eventA));
    await db.delete(schema.ticketTypes).where(eq(schema.ticketTypes.eventId, eventB));
    await db.delete(schema.events).where(eq(schema.events.id, eventA));
    await db.delete(schema.events).where(eq(schema.events.id, eventB));
    await queryClient.end();
  });

  const mine = (rows: { order: { id: string } }[]) =>
    rows.map((r) => r.order.id).filter((id) => ids.includes(id));

  it('matches each identifier exactly and the email as a substring, joined with event + type', async () => {
    const byTrx = await ordersRepository.search(
      { term: normaliseSearchTerm(`tx${tag}`) },
      { limit: 10, offset: 0 },
    );
    expect(mine(byTrx.rows)).toEqual([a1]);
    expect(byTrx.rows[0]?.eventTitle).toBe('Search A');
    expect(byTrx.rows[0]?.ticketTypeName).toBe('General');

    const byPhone = await ordersRepository.search(
      { term: normaliseSearchTerm('01912345678') },
      { limit: 10, offset: 0 },
    );
    expect(mine(byPhone.rows)).toEqual([a2]);

    const byEmail = await ordersRepository.search(
      { term: normaliseSearchTerm(`FARHANA.${tag}`) },
      { limit: 10, offset: 0 },
    );
    expect(mine(byEmail.rows)).toEqual([b1]);
  });

  it('escapes LIKE wildcards: "100%" finds the literal address, not everything', async () => {
    const r = await ordersRepository.search(
      { term: normaliseSearchTerm(`100%_${tag}`) },
      { limit: 10, offset: 0 },
    );
    expect(mine(r.rows)).toEqual([b2]);
  });

  it('ANDs status, event and the Dhaka date range; sorts newest first; counts the total', async () => {
    const byEvent = await ordersRepository.search({ eventId: eventB }, { limit: 10, offset: 0 });
    expect(mine(byEvent.rows)).toEqual([b2, b1]);
    expect(byEvent.total).toBe(2);

    const issuedA = await ordersRepository.search(
      { eventId: eventA, status: 'issued' },
      { limit: 10, offset: 0 },
    );
    expect(mine(issuedA.rows)).toEqual([a2]);

    // Dhaka day 2026-09-16 is [2026-09-15T18:00Z, 2026-09-16T18:00Z): only a2.
    const day = await ordersRepository.search(
      {
        eventId: eventA,
        createdFrom: new Date('2026-09-15T18:00:00Z'),
        createdBefore: new Date('2026-09-16T18:00:00Z'),
      },
      { limit: 10, offset: 0 },
    );
    expect(mine(day.rows)).toEqual([a2]);
  });

  it('paginates with offset/limit and a stable total', async () => {
    const p1 = await ordersRepository.search({ eventId: eventB }, { limit: 1, offset: 0 });
    const p2 = await ordersRepository.search({ eventId: eventB }, { limit: 1, offset: 1 });
    expect(p1.total).toBe(2);
    expect(p2.total).toBe(2);
    expect(mine(p1.rows)).toEqual([b2]);
    expect(mine(p2.rows)).toEqual([b1]);
  });

  it('sorts by a whitelisted column with the id tiebreak, in both directions', async () => {
    const asc = await ordersRepository.search(
      { eventId: eventA },
      { limit: 10, offset: 0 },
      { column: 'reference', desc: false },
    );
    const desc = await ordersRepository.search(
      { eventId: eventA },
      { limit: 10, offset: 0 },
      { column: 'reference', desc: true },
    );
    expect(mine(asc.rows)).toEqual([a1, a2]);
    expect(mine(desc.rows)).toEqual([a2, a1]);
  });

  it('totalsByStatus groups count and sum per status, ignoring the status filter', async () => {
    const totals = await ordersRepository.totalsByStatus({ eventId: eventA, status: 'issued' });
    const byStatus = new Map(totals.map((t) => [t.status, t]));
    expect(byStatus.get('pending_verification')).toEqual({
      status: 'pending_verification',
      count: 1,
      totalPaisa: 120_000,
    });
    expect(byStatus.get('issued')).toEqual({ status: 'issued', count: 1, totalPaisa: 120_000 });
    expect(byStatus.size).toBe(2);
  });
});
