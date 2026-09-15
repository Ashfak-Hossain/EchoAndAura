import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { reserveTicketInventory } from '@/server/services/inventory.service';

/**
 * THE most important test in this repo (CLAUDE.md § Testing). It proves the
 * atomic inventory reservation (Invariant 2) never oversells under concurrency.
 *
 * Requires a real Postgres — run `docker compose up -d` first. Uses
 * TEST_DATABASE_URL, falling back to DATABASE_URL. This test must NEVER be
 * skipped or weakened.
 *
 * Phase 0 status: RED for the right reason — reserveTicketInventory is a stub
 * that throws, so zero reservations succeed. It goes green in Phase 3 when the
 * conditional atomic UPDATE lands, with no change to this test.
 */

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const STOCK = 20; // quantity_total
const BUYERS = 50; // concurrent reservation attempts, each of quantity 1

describe('inventory reservation under concurrency', () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let eventId: string;
  let ticketTypeId: string;

  beforeAll(async () => {
    if (!url) {
      throw new Error('TEST_DATABASE_URL or DATABASE_URL must be set for the integration suite');
    }
    client = postgres(url, { max: BUYERS + 5, onnotice: () => {} });
    db = drizzle(client, { schema });

    // Idempotent: applies any pending migrations to the target database.
    await migrate(db, { migrationsFolder: './drizzle' });

    eventId = randomUUID();
    ticketTypeId = randomUUID();

    await db.insert(schema.events).values({
      id: eventId,
      slug: `concurrency-${eventId}`,
      title: 'Concurrency Test Event',
      startsAt: new Date('2030-01-01T00:00:00Z'),
      status: 'published',
    });

    await db.insert(schema.ticketTypes).values({
      id: ticketTypeId,
      eventId,
      name: 'General',
      pricePaisa: 100_000,
      quantityTotal: STOCK,
    });
  });

  afterAll(async () => {
    if (db && ticketTypeId) {
      await db.delete(schema.ticketTypes).where(eq(schema.ticketTypes.id, ticketTypeId));
      await db.delete(schema.events).where(eq(schema.events.id, eventId));
    }
    if (client) {
      await client.end();
    }
  });

  it(`never oversells: ${BUYERS} concurrent buyers, ${STOCK} in stock`, async () => {
    const attempts = Array.from({ length: BUYERS }, () => reserveTicketInventory(ticketTypeId, 1));
    const results = await Promise.allSettled(attempts);

    const reserved = results.filter(
      (r): r is PromiseFulfilledResult<boolean> => r.status === 'fulfilled' && r.value === true,
    ).length;

    // Exactly STOCK reservations succeed; every other buyer sees sold-out.
    expect(reserved).toBe(STOCK);

    const [row] = await db
      .select()
      .from(schema.ticketTypes)
      .where(eq(schema.ticketTypes.id, ticketTypeId));

    // The database never oversold: reserved matches stock, availability >= 0.
    expect(row.quantityReserved).toBe(STOCK);
    expect(row.quantityTotal - row.quantitySold - row.quantityReserved).toBeGreaterThanOrEqual(0);
  });
});
