import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import { SponsorNotFoundError, SponsorPresentingConflictError } from '@/server/lib/errors';
import { isCheckViolation } from '@/server/lib/pg-errors';
import { eventsRepository } from '@/server/repositories/events.repository';
import {
  type NewSponsor,
  type SponsorLevel,
  sponsorsRepository as repo,
} from '@/server/repositories/sponsors.repository';
import { createSponsorsService } from '@/server/services/sponsors.service';

/**
 * B15 against real Postgres: the partial unique index allows one
 * presenting partner and its violation maps to a typed error; renumbering
 * rewrites a level in one statement (a swap never trips anything);
 * demotion lands on Partner #1; reads sort level → position → created_at
 * → id; and the service, wired like the container, keeps levels dense —
 * including when several admins save at once (the advisory lock). An
 * event's presenting sponsor is a foreign key: deleting the sponsor clears
 * it (SET NULL), and naming one that does not exist maps to a typed error.
 *
 * `sponsors` is one global list (and the index is table-wide), so every
 * test starts from an empty table in the integration database.
 */

const T0 = new Date('2026-09-25T10:00:00Z');
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><rect width="300" height="100"/></svg>',
);

function sponsor(
  name: string,
  level: SponsorLevel,
  position: number,
  over: Partial<NewSponsor> = {},
): NewSponsor {
  const id = over.id ?? randomUUID();
  return {
    id,
    name,
    websiteUrl: null,
    level,
    logoKey: `sponsors/${id}/logo-abcdefghijkl.svg`,
    logoWidth: 300,
    logoHeight: 100,
    tileTone: 'light',
    active: true,
    position,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

const insert = (values: NewSponsor) => db.transaction((tx) => repo.insert(values, tx));

/** "position:name" for one level, in display order. */
async function level(which: SponsorLevel): Promise<string[]> {
  const rows = await repo.listAll();
  return rows.filter((r) => r.level === which).map((r) => `${r.position}:${r.name}`);
}

// The real service against the real repository; storage is in memory
// (the storage round-trip has its own test in storage.test.ts).
const objects = new Map<string, Uint8Array>();
const service = createSponsorsService({
  sponsors: repo,
  storage: {
    put: async ({ key, body }) => {
      objects.set(key, body);
    },
    delete: async (key) => {
      objects.delete(key);
    },
    publicUrl: (key) => `https://cdn.test/${key}`,
  },
  runInTransaction: (fn) => db.transaction(fn),
});
const add = (name: string, which: SponsorLevel, position?: number) =>
  service.create(
    {
      name,
      websiteUrl: null,
      level: which,
      tileTone: 'light',
      active: true,
      position,
      logo: { bytes: SVG, contentType: 'image/svg+xml' },
    },
    'raj@example.com',
  );

describe('sponsorsRepository (Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  beforeEach(async () => {
    await db.delete(schema.sponsors);
    objects.clear();
  });

  // Events made by the "Presented by" tests; removed at the end.
  const eventIds: string[] = [];
  const newEvent = async (presentingSponsorId: string | null) => {
    const row = await eventsRepository.insert({
      slug: `presented-${randomUUID()}`,
      title: 'Presented by test',
      startsAt: new Date('2026-10-01T13:00:00Z'),
      presentingSponsorId,
    });
    eventIds.push(row.id);
    return row;
  };

  afterAll(async () => {
    if (eventIds.length > 0) {
      await db.delete(schema.events).where(inArray(schema.events.id, eventIds));
    }
    await db.delete(schema.sponsors);
    await queryClient.end();
  });

  it('allows one presenting partner: a second is refused by the index and mapped', async () => {
    await insert(sponsor('Kolorob Audio', 'presenting', 1));
    await expect(insert(sponsor('Megh Stage', 'presenting', 1))).rejects.toBeInstanceOf(
      SponsorPresentingConflictError,
    );
    const partner = await insert(sponsor('Nodi Coffee', 'partner', 1));
    await expect(
      db.transaction((tx) => repo.update(partner.id, { level: 'presenting' }, tx)),
    ).rejects.toBeInstanceOf(SponsorPresentingConflictError);
    // Any number of partners and supporters.
    await insert(sponsor('Shonar Tori', 'partner', 2));
    expect(await level('presenting')).toEqual(['1:Kolorob Audio']);
    expect(await level('partner')).toEqual(['1:Nodi Coffee', '2:Shonar Tori']);
  });

  it('the CHECKs refuse a non-positive position or logo size', async () => {
    for (const bad of [
      sponsor('Zero', 'partner', 0),
      sponsor('Flat', 'partner', 1, { logoHeight: 0 }),
      sponsor('Thin', 'partner', 1, { logoWidth: -1 }),
    ]) {
      const err = await insert(bad).catch((e: unknown) => e);
      expect(
        isCheckViolation(err, 'sponsors_position_positive') ||
          isCheckViolation(err, 'sponsors_logo_width_positive') ||
          isCheckViolation(err, 'sponsors_logo_height_positive'),
      ).toBe(true);
    }
  });

  it('renumber rewrites a whole level densely in one statement; a swap is fine', async () => {
    const a = await insert(sponsor('A', 'supporter', 1));
    const b = await insert(sponsor('B', 'supporter', 2));
    const c = await insert(sponsor('C', 'supporter', 7));
    const d = await insert(sponsor('D', 'supporter', 9));
    await insert(sponsor('P', 'partner', 1));

    await db.transaction((tx) => repo.renumber([d.id, b.id, a.id, c.id], tx));
    expect(await level('supporter')).toEqual(['1:D', '2:B', '3:A', '4:C']);
    await db.transaction((tx) => repo.renumber([b.id, d.id, a.id, c.id], tx));
    expect(await level('supporter')).toEqual(['1:B', '2:D', '3:A', '4:C']);
    // Another level is untouched; ids are returned in the same order.
    expect(await level('partner')).toEqual(['1:P']);
    expect(await db.transaction((tx) => repo.listIdsByLevel('supporter', tx))).toEqual([
      b.id,
      d.id,
      a.id,
      c.id,
    ]);
  });

  it('demotePresenting moves the presenting partner to Partner #1, shifting the partners', async () => {
    const top = await insert(sponsor('Kolorob Audio', 'presenting', 1));
    await insert(sponsor('Nodi Coffee', 'partner', 1));
    await insert(sponsor('Shonar Tori', 'partner', 2));
    const at = new Date('2026-09-25T11:00:00Z');

    // Keeping the presenting one itself is a no-op.
    expect(await db.transaction((tx) => repo.demotePresenting(top.id, at, tx))).toBeNull();
    const demoted = await db.transaction((tx) => repo.demotePresenting(null, at, tx));
    expect(demoted).toMatchObject({ id: top.id, level: 'partner', position: 1, updatedAt: at });
    expect(await level('presenting')).toEqual([]);
    expect(await level('partner')).toEqual(['1:Kolorob Audio', '2:Nodi Coffee', '3:Shonar Tori']);
    expect(await db.transaction((tx) => repo.demotePresenting(null, at, tx))).toBeNull();
  });

  it('reads sort by level, position, created_at, id; listActive leaves out hidden ones', async () => {
    const later = new Date(T0.getTime() + 60_000);
    await insert(sponsor('S-late', 'supporter', 1, { createdAt: later }));
    await insert(sponsor('S-early', 'supporter', 1));
    await insert(sponsor('S2', 'supporter', 2, { active: false }));
    await insert(sponsor('P1', 'partner', 1));
    await insert(sponsor('Top', 'presenting', 1));

    expect((await repo.listAll()).map((r) => r.name)).toEqual([
      'Top',
      'P1',
      'S-early',
      'S-late',
      'S2',
    ]);
    expect((await repo.listActive()).map((r) => r.name)).toEqual([
      'Top',
      'P1',
      'S-early',
      'S-late',
    ]);
  });

  it('through the service: a level move closes the gap, a new presenting partner demotes the old', async () => {
    await add('A', 'supporter');
    const b = await add('B', 'supporter');
    await add('C', 'supporter');
    const kolorob = await add('Kolorob Audio', 'presenting');
    await add('Nodi Coffee', 'partner');

    await service.update(
      b.id,
      {
        name: 'B',
        websiteUrl: 'https://b.example',
        level: 'partner',
        tileTone: 'dark',
        active: true,
        position: 1,
      },
      'raj@example.com',
    );
    expect(await level('supporter')).toEqual(['1:A', '2:C']);
    expect(await level('partner')).toEqual(['1:B', '2:Nodi Coffee']);

    await add('Megh Stage', 'presenting');
    expect(await level('presenting')).toEqual(['1:Megh Stage']);
    expect(await level('partner')).toEqual(['1:Kolorob Audio', '2:B', '3:Nodi Coffee']);

    await service.delete(kolorob.id, 'raj@example.com');
    expect(await level('partner')).toEqual(['1:B', '2:Nodi Coffee']);
    expect(objects.has(kolorob.logoKey)).toBe(false);
  });

  it('concurrent saves are serialised by the advisory lock: positions stay 1…n, one presenting', async () => {
    const names = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
    const results = await Promise.allSettled([
      ...names.map((n) => add(n, 'supporter', 1)),
      add('Kolorob Audio', 'presenting'),
      add('Megh Stage', 'presenting'),
    ]);
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);

    const supporters = await level('supporter');
    expect(supporters.map((s) => s.split(':')[0])).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(supporters.map((s) => s.split(':')[1]).sort()).toEqual(names);
    // Whichever saved last is presenting; the other was demoted, not refused.
    expect(await level('presenting')).toHaveLength(1);
    expect(await level('partner')).toHaveLength(1);
  });
  it('deleting a sponsor clears it from the events it presents, and nothing else', async () => {
    const kolorob = await add('Kolorob Audio', 'presenting');
    const nodi = await add('Nodi Coffee', 'partner');
    const presented = await newEvent(kolorob.id);
    const other = await newEvent(nodi.id);
    expect(presented.presentingSponsorId).toBe(kolorob.id);

    await service.delete(kolorob.id, 'raj@example.com');

    // ON DELETE SET NULL: the event stays, its "Presented by" goes.
    expect(await eventsRepository.findById(presented.id)).toMatchObject({
      id: presented.id,
      presentingSponsorId: null,
    });
    expect((await eventsRepository.findById(other.id))?.presentingSponsorId).toBe(nodi.id);
  });

  it('an event naming a sponsor that does not exist is refused and mapped', async () => {
    const gone = randomUUID();
    await expect(newEvent(gone)).rejects.toBeInstanceOf(SponsorNotFoundError);

    const nodi = await add('Nodi Coffee', 'partner');
    const event = await newEvent(null);
    await expect(
      eventsRepository.update(event.id, { presentingSponsorId: gone }),
    ).rejects.toMatchObject({ sponsorId: gone });
    // Setting and clearing a real one both work.
    expect(
      (await eventsRepository.update(event.id, { presentingSponsorId: nodi.id }))
        ?.presentingSponsorId,
    ).toBe(nodi.id);
    expect(
      (await eventsRepository.update(event.id, { presentingSponsorId: null }))?.presentingSponsorId,
    ).toBeNull();
  });
});
