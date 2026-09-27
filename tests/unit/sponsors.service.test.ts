import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DbExecutor } from '@/db/executor';
import {
  SponsorLogoInvalidError,
  SponsorNotFoundError,
  SponsorPresentingConflictError,
} from '@/server/lib/errors';
import type {
  SponsorLevel,
  SponsorRecord,
  SponsorsRepository,
} from '@/server/repositories/sponsors.repository';
import {
  type CreateSponsorInput,
  type SponsorLogoUpload,
  createSponsorsService,
} from '@/server/services/sponsors.service';
import type { PutObjectInput } from '@/server/storage/object-storage';

/**
 * B15 sponsors service with an in-memory repository and storage. The
 * fakes record every storage call made while a transaction is open: the
 * service must upload before the transaction and delete after it
 * (Invariant 7), so that list stays empty in every test.
 */

const T0 = new Date('2026-09-25T10:00:00Z');
const ACTOR = 'raj@example.com';
const LEVEL_ORDER: SponsorLevel[] = ['presenting', 'partner', 'supporter'];

const utf8 = (s: string) => new TextEncoder().encode(s);
const svgLogo = (w = 300, h = 100): SponsorLogoUpload => ({
  bytes: utf8(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}"/></svg>`,
  ),
  contentType: 'image/svg+xml',
});

/** A PNG's signature and IHDR — all the logo screen reads. */
function pngLogo(width: number, height: number): SponsorLogoUpload {
  const bytes = new Uint8Array(8 + 25);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set(utf8('IHDR'), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return { bytes, contentType: 'image/png' };
}

interface Harness {
  storageInTx: string[];
}
const harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses.splice(0)) expect(h.storageInTx).toEqual([]);
});

function build() {
  const rows = new Map<string, SponsorRecord>();
  const objects = new Map<string, PutObjectInput>();
  const deletes: string[] = [];
  const storageInTx: string[] = [];
  const writesOutsideTx: string[] = [];
  let inTx = false;
  let locks = 0;
  let transactions = 0;
  let ids = 0;
  let clock = T0.getTime();
  const TX = { marker: 'tx' } as unknown as DbExecutor;
  const fail = { put: false, delete: false, insert: false, update: false, skipDemote: false };

  const inOrder = (a: SponsorRecord, b: SponsorRecord) =>
    LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) ||
    a.position - b.position ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id);
  const sorted = () => [...rows.values()].sort(inOrder).map((r) => ({ ...r }));
  const write = (what: string, tx: DbExecutor) => {
    if (!inTx || tx !== TX) writesOutsideTx.push(what);
  };
  const assertOnePresenting = (candidate: SponsorRecord) => {
    const other = [...rows.values()].find((r) => r.level === 'presenting' && r.id !== candidate.id);
    if (candidate.level === 'presenting' && other) throw new SponsorPresentingConflictError();
  };

  const repo: SponsorsRepository = {
    lock: async (tx) => {
      write('lock', tx);
      locks++;
    },
    findById: async (id) => {
      const r = rows.get(id);
      return r ? { ...r } : null;
    },
    listAll: async () => sorted(),
    listActive: async () => sorted().filter((r) => r.active),
    listIdsByLevel: async (level) =>
      sorted()
        .filter((r) => r.level === level)
        .map((r) => r.id),
    insert: async (values, tx) => {
      write('insert', tx);
      if (fail.insert) throw new Error('connection reset');
      const row: SponsorRecord = { ...values };
      assertOnePresenting(row);
      rows.set(row.id, row);
      return { ...row };
    },
    update: async (id, patch, tx) => {
      write('update', tx);
      if (fail.update) throw new Error('connection reset');
      const r = rows.get(id);
      if (!r) return null;
      const next = { ...r, ...patch };
      assertOnePresenting(next);
      rows.set(id, next);
      return { ...next };
    },
    delete: async (id, tx) => {
      write('delete', tx);
      const r = rows.get(id);
      if (!r) return null;
      rows.delete(id);
      return { ...r };
    },
    demotePresenting: async (keepId, at, tx) => {
      write('demote', tx);
      if (fail.skipDemote) return null;
      const current = [...rows.values()].find((r) => r.level === 'presenting' && r.id !== keepId);
      if (!current) return null;
      for (const r of rows.values()) if (r.level === 'partner') r.position += 1;
      Object.assign(current, { level: 'partner', position: 1, updatedAt: at });
      return { ...current };
    },
    renumber: async (order, tx) => {
      write('renumber', tx);
      order.forEach((id, i) => {
        const r = rows.get(id);
        if (r) r.position = i + 1;
      });
    },
  };

  const storage = {
    async put(input: PutObjectInput) {
      if (inTx) storageInTx.push(`put ${input.key}`);
      if (fail.put) throw new Error('storage down');
      objects.set(input.key, input);
    },
    async delete(key: string) {
      if (inTx) storageInTx.push(`delete ${key}`);
      deletes.push(key);
      if (fail.delete) throw new Error('storage down');
      objects.delete(key);
    },
    publicUrl: (key: string) => `https://cdn.test/${key}`,
  };

  const logger = { info: vi.fn(), warn: vi.fn() };

  const svc = createSponsorsService({
    sponsors: repo,
    storage,
    runInTransaction: async (fn) => {
      transactions++;
      // Rollback: a failed transaction leaves the rows as they were.
      const snapshot = new Map([...rows].map(([k, v]) => [k, { ...v }]));
      inTx = true;
      try {
        return await fn(TX);
      } catch (err: unknown) {
        rows.clear();
        for (const [k, v] of snapshot) rows.set(k, v);
        throw err;
      } finally {
        inTx = false;
      }
    },
    now: () => new Date((clock += 1000)),
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    logger,
  });

  const harness = {
    svc,
    rows,
    objects,
    deletes,
    storageInTx,
    writesOutsideTx,
    fail,
    logger,
    get locks() {
      return locks;
    },
    get transactions() {
      return transactions;
    },
    /** Names of one level in display order, with their stored positions. */
    level(level: SponsorLevel) {
      return sorted()
        .filter((r) => r.level === level)
        .map((r) => `${r.position}:${r.name}`);
    },
    add(name: string, level: SponsorLevel, over: Partial<CreateSponsorInput> = {}) {
      return svc.create(
        {
          name,
          websiteUrl: null,
          level,
          tileTone: 'light',
          active: true,
          logo: svgLogo(),
          ...over,
        },
        ACTOR,
      );
    },
  };
  harnesses.push(harness);
  return harness;
}

describe('sponsorsService.create', () => {
  it('inspects the logo, uploads it before the transaction, then inserts at the end of its level', async () => {
    const h = build();
    await h.add('Nodi Coffee', 'partner');
    const row = await h.add('Parabaas Printing', 'partner', {
      websiteUrl: 'https://parabaas.example',
      tileTone: 'dark',
      logo: svgLogo(700, 100),
    });

    expect(row).toMatchObject({
      name: 'Parabaas Printing',
      websiteUrl: 'https://parabaas.example',
      level: 'partner',
      tileTone: 'dark',
      active: true,
      position: 2,
      logoWidth: 700,
      logoHeight: 100,
    });
    // The key carries the owner; a fresh one per upload.
    expect(row.logoKey).toMatch(new RegExp(`^sponsors/${row.id}/logo-[A-Za-z0-9_-]{12}\\.svg$`));
    expect(h.objects.get(row.logoKey)).toMatchObject({
      contentType: 'image/svg+xml',
      contentDisposition: 'attachment',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    expect(h.level('partner')).toEqual(['1:Nodi Coffee', '2:Parabaas Printing']);
    expect(h.locks).toBe(2);
    expect(h.writesOutsideTx).toEqual([]);
    expect(h.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ actor: ACTOR, sponsorId: row.id, name: 'Parabaas Printing' }),
      'sponsor created',
    );
  });

  it('stores a PNG under .png with its pixel size', async () => {
    const h = build();
    const row = await h.add('Bhor FM', 'supporter', { logo: pngLogo(400, 200) });
    expect(row.logoKey).toMatch(/\.png$/);
    expect(row).toMatchObject({ logoWidth: 400, logoHeight: 200 });
    expect(h.objects.get(row.logoKey)?.contentType).toBe('image/png');
  });

  it('refuses an unsafe or mislabelled logo without touching storage or the database', async () => {
    const h = build();
    const script = utf8(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>',
    );
    const err = await h
      .add('Bad', 'partner', { logo: { bytes: script, contentType: 'image/svg+xml' } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SponsorLogoInvalidError);
    expect((err as SponsorLogoInvalidError).reason).toMatch(/<script>/);
    // SVG bytes declared as a PNG.
    await expect(
      h.add('Liar', 'partner', { logo: { ...svgLogo(), contentType: 'image/png' } }),
    ).rejects.toBeInstanceOf(SponsorLogoInvalidError);
    expect(h.objects.size).toBe(0);
    expect(h.deletes).toEqual([]);
    expect(h.rows.size).toBe(0);
    expect(h.transactions).toBe(0);
  });

  it('removes the fresh upload and rethrows when the database step fails', async () => {
    const h = build();
    h.fail.insert = true;
    await expect(h.add('Nodi Coffee', 'partner')).rejects.toThrow('connection reset');
    expect(h.deletes).toHaveLength(1);
    expect(h.objects.size).toBe(0);
    expect(h.rows.size).toBe(0);
  });

  it('a failed cleanup is logged, and the database error is still the one thrown', async () => {
    const h = build();
    h.fail.insert = true;
    h.fail.delete = true;
    await expect(h.add('Nodi Coffee', 'partner')).rejects.toThrow('connection reset');
    expect(h.logger.warn).toHaveBeenCalledOnce();
  });

  it('a storage failure stops the save before any row is written', async () => {
    const h = build();
    h.fail.put = true;
    await expect(h.add('Nodi Coffee', 'partner')).rejects.toThrow('storage down');
    expect(h.transactions).toBe(0);
  });
});

describe('presenting partner', () => {
  it('saving a new presenting partner moves the current one to Partner #1', async () => {
    const h = build();
    await h.add('Kolorob Audio', 'presenting');
    await h.add('Nodi Coffee', 'partner');
    await h.add('Shonar Tori', 'partner');
    await h.add('Megh Stage', 'presenting');

    expect(h.level('presenting')).toEqual(['1:Megh Stage']);
    expect(h.level('partner')).toEqual(['1:Kolorob Audio', '2:Nodi Coffee', '3:Shonar Tori']);
    expect(h.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Kolorob Audio' }),
      'sponsor demoted to partner #1',
    );
  });

  it('promoting a partner demotes the old presenting partner and closes the promoted one’s gap', async () => {
    const h = build();
    await h.add('Kolorob Audio', 'presenting');
    await h.add('Nodi Coffee', 'partner');
    const shonar = await h.add('Shonar Tori', 'partner');
    await h.add('Parabaas', 'partner');

    await h.svc.update(
      shonar.id,
      {
        name: 'Shonar Tori',
        websiteUrl: null,
        level: 'presenting',
        tileTone: 'light',
        active: true,
      },
      ACTOR,
    );
    expect(h.level('presenting')).toEqual(['1:Shonar Tori']);
    expect(h.level('partner')).toEqual(['1:Kolorob Audio', '2:Nodi Coffee', '3:Parabaas']);
  });

  it('re-saving the presenting partner keeps it presenting', async () => {
    const h = build();
    const kolorob = await h.add('Kolorob Audio', 'presenting');
    await h.svc.update(
      kolorob.id,
      { name: 'Kolorob', websiteUrl: null, level: 'presenting', tileTone: 'dark', active: true },
      ACTOR,
    );
    expect(h.level('presenting')).toEqual(['1:Kolorob']);
    expect(h.level('partner')).toEqual([]);
  });

  it('a clash the index catches surfaces as SponsorPresentingConflictError, upload removed', async () => {
    const h = build();
    await h.add('Kolorob Audio', 'presenting');
    // A writer that skipped the demotion (or raced it): the backstop refuses.
    h.fail.skipDemote = true;
    await expect(h.add('Megh Stage', 'presenting')).rejects.toBeInstanceOf(
      SponsorPresentingConflictError,
    );
    expect(h.objects.size).toBe(1);
    expect(h.level('presenting')).toEqual(['1:Kolorob Audio']);
  });
});

describe('ordering', () => {
  it('clamps a requested position to 1…n+1 and keeps the level dense', async () => {
    const h = build();
    await h.add('A', 'supporter');
    await h.add('B', 'supporter');
    await h.add('C', 'supporter', { position: 99 });
    await h.add('D', 'supporter', { position: 0 });
    await h.add('E', 'supporter', { position: 3 });
    expect(h.level('supporter')).toEqual(['1:D', '2:A', '3:E', '4:B', '5:C']);
  });

  it('setPosition moves within the level; out-of-range numbers clamp', async () => {
    const h = build();
    const a = await h.add('A', 'supporter');
    await h.add('B', 'supporter');
    const c = await h.add('C', 'supporter');
    await h.add('P', 'partner');

    expect((await h.svc.setPosition(c.id, 1, ACTOR)).position).toBe(1);
    expect(h.level('supporter')).toEqual(['1:C', '2:A', '3:B']);
    // ▲ on the first row asks for 0: clamped, nothing moves.
    expect((await h.svc.setPosition(c.id, 0, ACTOR)).position).toBe(1);
    expect((await h.svc.setPosition(a.id, 42, ACTOR)).position).toBe(3);
    expect(h.level('supporter')).toEqual(['1:C', '2:B', '3:A']);
    expect(h.level('partner')).toEqual(['1:P']);
    expect(h.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'A', from: 2, to: 3 }),
      'sponsor moved',
    );
  });

  it('a level change lands at the end of the new level and closes the gap in the old one', async () => {
    const h = build();
    await h.add('A', 'supporter');
    const b = await h.add('B', 'supporter');
    const c = await h.add('C', 'supporter');
    await h.add('P', 'partner');
    const edit = { websiteUrl: null, tileTone: 'light', active: true } as const;

    await h.svc.update(b.id, { ...edit, name: 'B', level: 'partner' }, ACTOR);
    expect(h.level('partner')).toEqual(['1:P', '2:B']);
    expect(h.level('supporter')).toEqual(['1:A', '2:C']);

    await h.svc.update(c.id, { ...edit, name: 'C', level: 'partner', position: 1 }, ACTOR);
    expect(h.level('partner')).toEqual(['1:C', '2:P', '3:B']);
    expect(h.level('supporter')).toEqual(['1:A']);
  });

  it('an edit without a position keeps its place; with one, it moves', async () => {
    const h = build();
    await h.add('A', 'partner');
    const b = await h.add('B', 'partner');
    await h.add('C', 'partner');
    const edit = { websiteUrl: 'https://b.example', level: 'partner', tileTone: 'dark' } as const;

    const row = await h.svc.update(b.id, { ...edit, name: 'Bee', active: false }, ACTOR);
    expect(row).toMatchObject({ position: 2, active: false, tileTone: 'dark' });
    expect(h.level('partner')).toEqual(['1:A', '2:Bee', '3:C']);

    await h.svc.update(b.id, { ...edit, name: 'Bee', active: true, position: 3 }, ACTOR);
    expect(h.level('partner')).toEqual(['1:A', '2:C', '3:Bee']);
  });
});

describe('sponsorsService.update', () => {
  it('a new logo replaces the old one, which is deleted only after commit', async () => {
    const h = build();
    const row = await h.add('Nodi Coffee', 'partner');
    const updated = await h.svc.update(
      row.id,
      {
        name: 'Nodi Coffee',
        websiteUrl: null,
        level: 'partner',
        tileTone: 'light',
        active: true,
        logo: pngLogo(64, 64),
      },
      ACTOR,
    );
    expect(updated.logoKey).not.toBe(row.logoKey);
    expect(updated).toMatchObject({ logoWidth: 64, logoHeight: 64 });
    expect([...h.objects.keys()]).toEqual([updated.logoKey]);
    expect(h.deletes).toEqual([row.logoKey]);
  });

  it('without a logo, keeps the stored one', async () => {
    const h = build();
    const row = await h.add('Nodi Coffee', 'partner');
    const updated = await h.svc.update(
      row.id,
      { name: 'Nodi', websiteUrl: null, level: 'partner', tileTone: 'light', active: true },
      ACTOR,
    );
    expect(updated).toMatchObject({ name: 'Nodi', logoKey: row.logoKey, logoWidth: 300 });
    expect(h.deletes).toEqual([]);
  });

  it('when the database step fails, the new upload is removed and the old logo stays', async () => {
    const h = build();
    const row = await h.add('Nodi Coffee', 'partner');
    h.fail.update = true;
    await expect(
      h.svc.update(
        row.id,
        {
          name: 'Nodi',
          websiteUrl: null,
          level: 'partner',
          tileTone: 'light',
          active: true,
          logo: svgLogo(),
        },
        ACTOR,
      ),
    ).rejects.toThrow('connection reset');
    expect([...h.objects.keys()]).toEqual([row.logoKey]);
    expect(h.rows.get(row.id)).toMatchObject({ name: 'Nodi Coffee', logoKey: row.logoKey });
  });

  it('an unknown sponsor is not found, and nothing is uploaded', async () => {
    const h = build();
    await expect(
      h.svc.update(
        '00000000-0000-4000-8000-000000000999',
        {
          name: 'Ghost',
          websiteUrl: null,
          level: 'partner',
          tileTone: 'light',
          active: true,
          logo: svgLogo(),
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(SponsorNotFoundError);
    expect(h.objects.size).toBe(0);
  });
});

describe('sponsorsService.setActive / delete / get', () => {
  it('setActive switches a sponsor under the lock; unknown ids are not found', async () => {
    const h = build();
    const row = await h.add('Nodi Coffee', 'partner');
    expect((await h.svc.setActive(row.id, false, ACTOR)).active).toBe(false);
    expect(h.locks).toBe(2);
    const missing = '00000000-0000-4000-8000-000000000999';
    await expect(h.svc.setActive(missing, true, ACTOR)).rejects.toBeInstanceOf(
      SponsorNotFoundError,
    );
    await expect(h.svc.setPosition(missing, 1, ACTOR)).rejects.toBeInstanceOf(SponsorNotFoundError);
    await expect(h.svc.delete(missing, ACTOR)).rejects.toBeInstanceOf(SponsorNotFoundError);
    await expect(h.svc.get(missing)).rejects.toBeInstanceOf(SponsorNotFoundError);
    expect(h.writesOutsideTx).toEqual([]);
  });

  it('delete closes the gap and removes the logo object after commit', async () => {
    const h = build();
    await h.add('A', 'partner');
    const b = await h.add('B', 'partner');
    await h.add('C', 'partner');
    await h.svc.delete(b.id, ACTOR);
    expect(h.level('partner')).toEqual(['1:A', '2:C']);
    expect(h.deletes).toEqual([b.logoKey]);
    expect(h.objects.has(b.logoKey)).toBe(false);
    expect(h.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ sponsorId: b.id, name: 'B' }),
      'sponsor deleted',
    );
  });

  it('a failed logo delete is logged, never thrown: the row is already gone', async () => {
    const h = build();
    const row = await h.add('A', 'partner');
    h.fail.delete = true;
    await expect(h.svc.delete(row.id, ACTOR)).resolves.toBeUndefined();
    expect(h.rows.size).toBe(0);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: row.logoKey }),
      'sponsors.service: could not delete logo object',
    );
  });
});

describe('read models', () => {
  it('listForAdmin groups every level in display order, hidden ones included, with logo URLs', async () => {
    const h = build();
    await h.add('S1', 'supporter');
    await h.add('P1', 'partner', { active: false });
    await h.add('P2', 'partner');

    const groups = await h.svc.listForAdmin();
    expect(groups.map((g) => [g.level, g.sponsors.map((s) => s.name)])).toEqual([
      ['presenting', []],
      ['partner', ['P1', 'P2']],
      ['supporter', ['S1']],
    ]);
    const p1 = groups[1]?.sponsors[0];
    expect(p1?.logoUrl).toBe(`https://cdn.test/${p1?.logoKey}`);
  });

  it('listPublic lists active sponsors only, presenting → partner → supporter, tile fields only', async () => {
    const h = build();
    await h.add('S1', 'supporter');
    await h.add('Hidden', 'partner', { active: false });
    const p = await h.add('P1', 'partner', {
      websiteUrl: 'https://p1.example',
      tileTone: 'dark',
      logo: svgLogo(120, 40),
    });
    await h.add('Top', 'presenting');

    const list = await h.svc.listPublic();
    expect(list.map((s) => s.name)).toEqual(['Top', 'P1', 'S1']);
    expect(list[1]).toEqual({
      id: p.id,
      name: 'P1',
      websiteUrl: 'https://p1.example',
      level: 'partner',
      tileTone: 'dark',
      logoUrl: `https://cdn.test/${p.logoKey}`,
      logoWidth: 120,
      logoHeight: 40,
    });
  });
});
