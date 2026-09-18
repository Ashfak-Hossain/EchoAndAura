import { describe, expect, it, vi } from 'vitest';
import {
  EventNotFoundError,
  TicketTypeCapacityTooLowError,
  TicketTypeInUseError,
  TicketTypeNotFoundError,
} from '@/server/lib/errors';
import type {
  NewTicketType,
  TicketTypeRecord,
  TicketTypesRepository,
} from '@/server/repositories/ticket-types.repository';
import { createTicketTypesService } from '@/server/services/ticket-types.service';

const EVENT_ID = 'event-1';

/**
 * In-memory repository honouring the real one's contract: the CHECK floor
 * (total ≥ sold + reserved) and FK behaviour surface as the same typed errors.
 */
function fakeRepo(seed: TicketTypeRecord[] = []) {
  const rows = new Map<string, TicketTypeRecord>(seed.map((r) => [r.id, r]));
  let counter = 0;

  const repo: TicketTypesRepository = {
    async listByEvent(eventId) {
      return [...rows.values()].filter((r) => r.eventId === eventId);
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async insert(values: NewTicketType) {
      if (values.eventId !== EVENT_ID) throw new EventNotFoundError(values.eventId);
      const row: TicketTypeRecord = {
        id: `tt-${++counter}`,
        ...values,
        quantitySold: 0,
        quantityReserved: 0,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      };
      rows.set(row.id, row);
      return row;
    },
    async update(id, patch) {
      const existing = rows.get(id);
      if (!existing) return null;
      const next = { ...existing, ...patch, updatedAt: new Date() };
      if (next.quantityTotal - next.quantitySold - next.quantityReserved < 0) {
        throw new TicketTypeCapacityTooLowError(id);
      }
      rows.set(id, next);
      return next;
    },
    async delete(id) {
      return rows.delete(id);
    },
  };
  return { repo, rows };
}

function record(overrides: Partial<TicketTypeRecord>): TicketTypeRecord {
  return {
    id: 'tt-seed',
    eventId: EVENT_ID,
    name: 'General',
    pricePaisa: 120_000,
    quantityTotal: 100,
    quantitySold: 0,
    quantityReserved: 0,
    salesStartsAt: null,
    salesEndsAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('ticketTypesService.createTicketType', () => {
  it('stores paisa untouched and nulls an absent sales window', async () => {
    const svc = createTicketTypesService(fakeRepo().repo);

    const tt = await svc.createTicketType(EVENT_ID, {
      name: 'Early Bird',
      pricePaisa: 79_950,
      quantityTotal: 100,
    });

    expect(tt.pricePaisa).toBe(79_950);
    expect(tt.quantitySold).toBe(0);
    expect(tt.quantityReserved).toBe(0);
    expect(tt.salesStartsAt).toBeNull();
  });

  it('surfaces EventNotFoundError for an unknown event (FK)', async () => {
    const svc = createTicketTypesService(fakeRepo().repo);
    await expect(
      svc.createTicketType('nope', { name: 'X', pricePaisa: 0, quantityTotal: 1 }),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });
});

describe('ticketTypesService.updateTicketType', () => {
  it('throws TicketTypeNotFoundError for an unknown id', async () => {
    const svc = createTicketTypesService(fakeRepo().repo);
    await expect(
      svc.updateTicketType('missing', { name: 'X', pricePaisa: 0, quantityTotal: 1 }),
    ).rejects.toBeInstanceOf(TicketTypeNotFoundError);
  });

  // Invariant 2 backstop: the floor comes from the DB, the service passes it on.
  it('propagates TicketTypeCapacityTooLowError when total undercuts sold + reserved', async () => {
    const seeded = record({ quantityTotal: 100, quantitySold: 30, quantityReserved: 10 });
    const svc = createTicketTypesService(fakeRepo([seeded]).repo);

    await expect(
      svc.updateTicketType(seeded.id, { name: 'General', pricePaisa: 120_000, quantityTotal: 39 }),
    ).rejects.toBeInstanceOf(TicketTypeCapacityTooLowError);

    const ok = await svc.updateTicketType(seeded.id, {
      name: 'General',
      pricePaisa: 120_000,
      quantityTotal: 40,
    });
    expect(ok.quantityTotal).toBe(40);
  });
});

describe('ticketTypesService.deleteTicketType', () => {
  it('refuses when anything is sold or reserved, without touching the repository', async () => {
    for (const counters of [
      { quantitySold: 1, quantityReserved: 0 },
      { quantitySold: 0, quantityReserved: 1 },
    ]) {
      const seeded = record(counters);
      const { repo } = fakeRepo([seeded]);
      const deleteSpy = vi.spyOn(repo, 'delete');
      const svc = createTicketTypesService(repo);

      await expect(svc.deleteTicketType(seeded.id)).rejects.toBeInstanceOf(TicketTypeInUseError);
      expect(deleteSpy).not.toHaveBeenCalled();
    }
  });

  it('deletes when nothing is sold or reserved', async () => {
    const seeded = record({});
    const { repo, rows } = fakeRepo([seeded]);
    const svc = createTicketTypesService(repo);

    await svc.deleteTicketType(seeded.id);
    expect(rows.has(seeded.id)).toBe(false);
  });

  it('throws TicketTypeNotFoundError for an unknown id', async () => {
    const svc = createTicketTypesService(fakeRepo().repo);
    await expect(svc.deleteTicketType('missing')).rejects.toBeInstanceOf(TicketTypeNotFoundError);
  });
});
