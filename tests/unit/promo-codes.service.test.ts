import { describe, expect, it } from 'vitest';
import type { DbExecutor } from '@/db/executor';
import { PromoCodeInUseError, PromoCodeNotFoundError } from '@/server/lib/errors';
import type {
  PromoCodeRecord,
  PromoCodesRepository,
} from '@/server/repositories/promo-codes.repository';
import { createPromoCodesService } from '@/server/services/promo-codes.service';
import { NOW, T0, event, ticketType } from './helpers/fake-db';

/** B10 admin service with an in-memory repository. */
function build() {
  const rows = new Map<string, PromoCodeRecord & { ticketTypeIds: string[]; used: boolean }>();
  let n = 0;
  const TX = { marker: 'tx' } as unknown as DbExecutor;
  const txs: DbExecutor[] = [];
  const repo: PromoCodesRepository = {
    findByCode: async (code) => {
      const r = [...rows.values()].find((x) => x.code === code);
      return r ? { ...r } : null;
    },
    findById: async (id) => {
      const r = rows.get(id);
      return r ? { ...r } : null;
    },
    list: async () => [],
    insert: async (values, ticketTypeIds, tx) => {
      txs.push(tx);
      const row = { id: `pc-${++n}`, ...values, createdAt: T0, updatedAt: T0 };
      rows.set(row.id, { ...row, ticketTypeIds, used: false });
      return row;
    },
    update: async (id, patch, ticketTypeIds, tx) => {
      txs.push(tx);
      const r = rows.get(id);
      if (!r) return null;
      Object.assign(r, patch, { ticketTypeIds });
      return r;
    },
    setActive: async (id, active) => {
      const r = rows.get(id);
      if (!r) return null;
      r.active = active;
      return r;
    },
    delete: async (id) => {
      const r = rows.get(id);
      if (r?.used) throw new PromoCodeInUseError(id);
      return rows.delete(id);
    },
  };
  const svc = createPromoCodesService({
    promoCodes: repo,
    events: {
      list: async () => [
        event(),
        event({ id: 'ev-past', title: 'Past', startsAt: new Date('2026-01-01T13:00:00Z') }),
        event({ id: 'ev-arch', title: 'Archived', status: 'archived' }),
        event({ id: 'ev-empty', title: 'No types' }),
      ],
    },
    ticketTypes: {
      listByEvents: async (ids) =>
        [
          ticketType(),
          ticketType({
            id: 'tt-ended',
            name: 'Early Bird',
            salesEndsAt: new Date('2026-09-01T00:00:00Z'),
          }),
          ticketType({ id: 'tt-past', eventId: 'ev-past', name: 'Old' }),
          ticketType({ id: 'tt-arch', eventId: 'ev-arch', name: 'Arch' }),
        ].filter((t) => ids.includes(t.eventId)),
    },
    runInTransaction: async (fn) => fn(TX),
    now: () => NOW,
  });
  return { svc, rows, txs, TX };
}

describe('promoCodesService', () => {
  it('creates in a transaction with the code normalised and restrictions de-duplicated', async () => {
    const { svc, rows, txs, TX } = build();
    const row = await svc.create(
      {
        code: ' dhaka15 ',
        type: 'percentage',
        value: 15,
        active: true,
        ticketTypeIds: ['tt-1', 'tt-1'],
      },
      'raj@example.com',
    );
    expect(row.code).toBe('DHAKA15');
    expect(rows.get(row.id)?.ticketTypeIds).toEqual(['tt-1']);
    expect(txs).toEqual([TX]);
  });

  it('updates everything but the code; a missing code is not found', async () => {
    const { svc, rows } = build();
    const row = await svc.create(
      { code: 'DHAKA15', type: 'percentage', value: 15, active: true, ticketTypeIds: [] },
      'raj',
    );
    await svc.update(
      row.id,
      { type: 'fixed', value: 20_000, active: false, ticketTypeIds: ['tt-1'] },
      'raj',
    );
    expect(rows.get(row.id)).toMatchObject({
      code: 'DHAKA15',
      type: 'fixed',
      value: 20_000,
      active: false,
    });
    await expect(
      svc.update('nope', { type: 'fixed', value: 1, active: true, ticketTypeIds: [] }, 'raj'),
    ).rejects.toBeInstanceOf(PromoCodeNotFoundError);
    await expect(svc.setActive('nope', true, 'raj')).rejects.toBeInstanceOf(PromoCodeNotFoundError);
    await expect(svc.get('nope')).rejects.toBeInstanceOf(PromoCodeNotFoundError);
  });

  it('deletes only a code no order used', async () => {
    const { svc, rows } = build();
    const a = await svc.create(
      { code: 'UNUSED', type: 'percentage', value: 5, active: true, ticketTypeIds: [] },
      'raj',
    );
    const b = await svc.create(
      { code: 'USED', type: 'percentage', value: 5, active: true, ticketTypeIds: [] },
      'raj',
    );
    rows.get(b.id)!.used = true;
    await svc.remove(a.id, 'raj');
    expect(rows.has(a.id)).toBe(false);
    await expect(svc.remove(b.id, 'raj')).rejects.toBeInstanceOf(PromoCodeInUseError);
    await expect(svc.remove('nope', 'raj')).rejects.toBeInstanceOf(PromoCodeNotFoundError);
  });

  it('the picker lists upcoming events with ticket types, marks ended sales, keeps named ones', async () => {
    const { svc } = build();
    const groups = await svc.pickerOptions();
    expect(groups.map((g) => g.event.id)).toEqual(['ev-1']);
    expect(groups[0]?.ticketTypes).toEqual([
      { id: 'tt-1', name: 'General', pricePaisa: 120_000, saleEnded: false },
      { id: 'tt-ended', name: 'Early Bird', pricePaisa: 120_000, saleEnded: true },
    ]);
    // A code already restricted to a past event's type still shows that event.
    const kept = await svc.pickerOptions(['tt-past']);
    expect(kept.map((g) => g.event.id)).toEqual(['ev-past', 'ev-1']);
  });
});
