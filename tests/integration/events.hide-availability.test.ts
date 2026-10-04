import { randomUUID } from 'node:crypto';
import { inArray, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import { eventsRepository } from '@/server/repositories/events.repository';

/**
 * ADR-055 on Postgres: `events.hide_availability` exists, is NOT NULL with a
 * database default of false (so every event created before the migration
 * keeps showing its counts), and round-trips through the repository.
 */
describe('events.hide_availability (Postgres)', () => {
  const ids: string[] = [];
  const base = () => ({
    slug: `hide-${randomUUID()}`,
    title: 'Hide availability test',
    startsAt: new Date('2026-10-01T13:00:00Z'),
  });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  afterAll(async () => {
    if (ids.length > 0) await db.delete(schema.events).where(inArray(schema.events.id, ids));
    await queryClient.end();
  });

  it('is a NOT NULL boolean defaulting to false in the database itself', async () => {
    const rows = await db.execute<{
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(sql`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'events'
        AND column_name = 'hide_availability'
    `);
    expect([...rows]).toEqual([
      { data_type: 'boolean', is_nullable: 'NO', column_default: 'false' },
    ]);
  });

  it('a row written without the column (as before the migration) reads back false', async () => {
    const b = base();
    const rows = await db.execute<{ id: string; hide_availability: boolean }>(sql`
      INSERT INTO events (slug, title, starts_at)
      VALUES (${b.slug}, ${b.title}, ${b.startsAt.toISOString()})
      RETURNING id, hide_availability
    `);
    const row = [...rows][0];
    expect(row?.hide_availability).toBe(false);
    if (row) ids.push(row.id);
    expect((await eventsRepository.findById(row!.id))?.hideAvailability).toBe(false);
  });

  it('refuses NULL', async () => {
    const b = base();
    await expect(
      db.execute(sql`
        INSERT INTO events (slug, title, starts_at, hide_availability)
        VALUES (${b.slug}, ${b.title}, ${b.startsAt.toISOString()}, NULL)
      `),
    ).rejects.toThrow();
  });

  it('round-trips through eventsRepository insert, update and reads', async () => {
    const plain = await eventsRepository.insert(base());
    ids.push(plain.id);
    expect(plain.hideAvailability).toBe(false);

    const hidden = await eventsRepository.insert({ ...base(), hideAvailability: true });
    ids.push(hidden.id);
    expect(hidden.hideAvailability).toBe(true);
    expect((await eventsRepository.findById(hidden.id))?.hideAvailability).toBe(true);
    expect((await eventsRepository.findBySlug(hidden.slug))?.hideAvailability).toBe(true);

    const on = await eventsRepository.update(plain.id, { hideAvailability: true });
    expect(on?.hideAvailability).toBe(true);
    const off = await eventsRepository.update(plain.id, { hideAvailability: false });
    expect(off?.hideAvailability).toBe(false);
    expect((await eventsRepository.findById(plain.id))?.hideAvailability).toBe(false);

    // A patch that does not mention it leaves it alone.
    const retitled = await eventsRepository.update(hidden.id, { title: 'Renamed' });
    expect(retitled).toMatchObject({ title: 'Renamed', hideAvailability: true });
  });
});
