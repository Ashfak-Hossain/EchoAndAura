import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import { isCheckViolation } from '@/server/lib/pg-errors';
import { eventsRepository } from '@/server/repositories/events.repository';

/**
 * ADR-029 on Postgres: the private-venue columns round-trip, and the
 * database refuses a private venue that does not exist — ticket holders are
 * promised one, whatever code path writes the row.
 */
describe('events private venue (Postgres)', () => {
  const ids: string[] = [];
  const base = () => ({
    slug: `venue-${randomUUID()}`,
    title: 'Private venue test',
    startsAt: new Date('2026-10-01T13:00:00Z'),
  });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  afterAll(async () => {
    if (ids.length > 0) await db.delete(schema.events).where(inArray(schema.events.id, ids));
    await queryClient.end();
  });

  it('stores and reads back a private venue with its public area; the default is public', async () => {
    const hidden = await eventsRepository.insert({
      ...base(),
      venue: 'Warehouse 7, Tejgaon I/A',
      venueHidden: true,
      venueArea: 'Tejgaon, Dhaka',
    });
    ids.push(hidden.id);
    expect(await eventsRepository.findById(hidden.id)).toMatchObject({
      venue: 'Warehouse 7, Tejgaon I/A',
      venueHidden: true,
      venueArea: 'Tejgaon, Dhaka',
    });

    const plain = await eventsRepository.insert({ ...base(), venue: 'ICCB Hall 4, Dhaka' });
    ids.push(plain.id);
    expect(plain).toMatchObject({ venueHidden: false, venueArea: null });

    const updated = await eventsRepository.update(hidden.id, {
      venueHidden: false,
      venueArea: null,
    });
    expect(updated).toMatchObject({ venueHidden: false, venueArea: null });
  });

  it('refuses a private venue with no venue', async () => {
    const err = await db
      .insert(schema.events)
      .values({ ...base(), venue: null, venueHidden: true })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(isCheckViolation(err, 'events_hidden_venue_set')).toBe(true);
  });
});
