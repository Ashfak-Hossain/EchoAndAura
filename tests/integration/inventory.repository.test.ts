import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import { InvalidQuantityError, InventoryStateError } from '@/server/lib/errors';
import { isCheckViolation } from '@/server/lib/pg-errors';
import { inventoryRepository as repo } from '@/server/repositories/inventory.repository';

/**
 * The three inventory primitives against real Postgres (the vitest
 * integration project points DATABASE_URL at the test database). The
 * concurrency test proves `reserve` never oversells under load; this file
 * proves each primitive's condition, the transaction rollback the order
 * service relies on, and that the CHECK constraint is a real backstop.
 */

const STOCK = 20;

describe('inventory repository', () => {
  let eventId: string;
  let ticketTypeId: string;

  beforeAll(async () => {
    // Idempotent; files run in parallel forks, so each DB-touching file
    // must not assume another one migrated the test database first.
    await migrate(db, { migrationsFolder: './drizzle' });

    eventId = randomUUID();
    await db.insert(schema.events).values({
      id: eventId,
      slug: `inventory-repo-${eventId}`,
      title: 'Inventory Repository Test Event',
      startsAt: new Date('2030-01-01T00:00:00Z'),
      status: 'published',
    });
  });

  // A fresh ticket type per test so counters start at zero every time.
  beforeEach(async () => {
    ticketTypeId = randomUUID();
    await db.insert(schema.ticketTypes).values({
      id: ticketTypeId,
      eventId,
      name: 'General',
      pricePaisa: 100_000,
      quantityTotal: STOCK,
    });
  });

  afterAll(async () => {
    await db.delete(schema.events).where(eq(schema.events.id, eventId)); // cascades
    await queryClient.end();
  });

  async function counters() {
    const [row] = await db
      .select({ sold: schema.ticketTypes.quantitySold, held: schema.ticketTypes.quantityReserved })
      .from(schema.ticketTypes)
      .where(eq(schema.ticketTypes.id, ticketTypeId));
    return row!;
  }

  it('reserve: holds while available, refuses (false, unchanged) once it is not', async () => {
    expect(await repo.reserve(ticketTypeId, 3)).toBe(true);
    expect(await counters()).toEqual({ sold: 0, held: 3 });

    // 17 left: asking for 18 is refused without touching the row.
    expect(await repo.reserve(ticketTypeId, 18)).toBe(false);
    expect(await counters()).toEqual({ sold: 0, held: 3 });

    // Exactly the remainder is fine.
    expect(await repo.reserve(ticketTypeId, 17)).toBe(true);
    expect(await counters()).toEqual({ sold: 0, held: 20 });
    expect(await repo.reserve(ticketTypeId, 1)).toBe(false);
  });

  // Defence in depth: a negative quantity would pass the availability WHERE
  // and silently free held tickets. The writer itself refuses it.
  it('refuses a non-positive or fractional quantity without touching the row', async () => {
    await repo.reserve(ticketTypeId, 2);
    for (const q of [0, -1, 1.5, NaN]) {
      await expect(repo.reserve(ticketTypeId, q)).rejects.toBeInstanceOf(InvalidQuantityError);
      await expect(repo.release(ticketTypeId, q)).rejects.toBeInstanceOf(InvalidQuantityError);
      await expect(repo.convertToSold(ticketTypeId, q)).rejects.toBeInstanceOf(
        InvalidQuantityError,
      );
    }
    expect(await counters()).toEqual({ sold: 0, held: 2 });
  });

  it('reserve: an unknown ticket type is simply unavailable', async () => {
    expect(await repo.reserve(randomUUID(), 1)).toBe(false);
  });

  it('release gives held tickets back; convertToSold moves held → sold', async () => {
    await repo.reserve(ticketTypeId, 3);
    await repo.release(ticketTypeId, 1);
    expect(await counters()).toEqual({ sold: 0, held: 2 });

    await repo.convertToSold(ticketTypeId, 2);
    expect(await counters()).toEqual({ sold: 2, held: 0 });
    // The two sold tickets are no longer available to anyone.
    expect(await repo.reserve(ticketTypeId, STOCK - 1)).toBe(false);
    expect(await repo.reserve(ticketTypeId, STOCK - 2)).toBe(true);
  });

  // Failure path: these are state bugs, never buyer outcomes.
  it('release / convertToSold beyond what is held throw and change nothing', async () => {
    await repo.reserve(ticketTypeId, 2);
    await expect(repo.release(ticketTypeId, 3)).rejects.toBeInstanceOf(InventoryStateError);
    await expect(repo.convertToSold(ticketTypeId, 3)).rejects.toBeInstanceOf(InventoryStateError);
    await expect(repo.release(randomUUID(), 1)).rejects.toBeInstanceOf(InventoryStateError);
    expect(await counters()).toEqual({ sold: 0, held: 2 });
  });

  // What order creation relies on: hold + insert order in one transaction,
  // so a failure after the hold leaves no orphaned reservation.
  it('a reserve inside a transaction rolls back with it', async () => {
    await expect(
      db.transaction(async (tx) => {
        expect(await repo.reserve(ticketTypeId, 5, tx)).toBe(true);
        throw new Error('order insert failed');
      }),
    ).rejects.toThrow('order insert failed');
    expect(await counters()).toEqual({ sold: 0, held: 0 });

    await db.transaction(async (tx) => {
      expect(await repo.reserve(ticketTypeId, 5, tx)).toBe(true);
    });
    expect(await counters()).toEqual({ sold: 0, held: 5 });
  });

  // The backstop: even a raw write that skips the WHERE clause is refused.
  it('Postgres CHECK refuses a raw update that would oversell', async () => {
    const raw = db
      .update(schema.ticketTypes)
      .set({ quantityReserved: sql`${schema.ticketTypes.quantityReserved} + ${STOCK + 1}` })
      .where(eq(schema.ticketTypes.id, ticketTypeId));
    const err = await raw.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isCheckViolation(err, 'ticket_types_availability_nonneg')).toBe(true);
    expect(await counters()).toEqual({ sold: 0, held: 0 });
  });
});
