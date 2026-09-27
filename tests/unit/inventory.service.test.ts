import { describe, expect, it, vi } from 'vitest';
import type { DbExecutor } from '@/db/executor';
import { InvalidQuantityError, InventoryStateError } from '@/server/lib/errors';
import {
  MAX_TICKETS_PER_ORDER,
  MIN_TICKETS_PER_ORDER,
  isValidOrderQuantity,
} from '@/server/lib/order-rules';
import type { InventoryRepository } from '@/server/repositories/inventory.repository';
import { createInventoryService } from '@/server/services/inventory.service';

/** In-memory counters honouring the repository contract. */
function fakeRepo(total = 20) {
  const state = { total, sold: 0, held: 0 };
  const repo: InventoryRepository = {
    reserve: vi.fn(async (_id, qty) => {
      if (state.total - state.sold - state.held < qty) return false;
      state.held += qty;
      return true;
    }),
    release: vi.fn(async (id, qty) => {
      if (state.held < qty) throw new InventoryStateError(id, 'release');
      state.held -= qty;
    }),
    convertToSold: vi.fn(async (id, qty) => {
      if (state.held < qty) throw new InventoryStateError(id, 'convertToSold');
      state.held -= qty;
      state.sold += qty;
    }),
    releaseSold: vi.fn(async (id, qty) => {
      if (state.sold < qty) throw new InventoryStateError(id, 'releaseSold');
      state.sold -= qty;
    }),
  };
  return { repo, state };
}

const TT = 'tt-1';

describe('order quantity rule', () => {
  it('accepts integers 1..10 and nothing else', () => {
    expect(MIN_TICKETS_PER_ORDER).toBe(1);
    expect(MAX_TICKETS_PER_ORDER).toBe(10);
    for (const q of [1, 5, 10]) expect(isValidOrderQuantity(q)).toBe(true);
    for (const q of [0, -1, 11, 2.5, NaN, Infinity]) expect(isValidOrderQuantity(q)).toBe(false);
  });
});

describe('inventoryService', () => {
  it('holds while available and reports sold-out as false', async () => {
    const { repo, state } = fakeRepo(3);
    const svc = createInventoryService(repo);
    expect(await svc.hold(TT, 2)).toBe(true);
    expect(await svc.hold(TT, 2)).toBe(false);
    expect(await svc.hold(TT, 1)).toBe(true);
    expect(state.held).toBe(3);
  });

  // Failure path: an out-of-range quantity never reaches the database.
  it('rejects an invalid quantity before touching the repository', async () => {
    const { repo } = fakeRepo();
    const svc = createInventoryService(repo);
    for (const q of [0, 11, 2.5, NaN, -3]) {
      await expect(svc.hold(TT, q)).rejects.toBeInstanceOf(InvalidQuantityError);
      await expect(svc.release(TT, q)).rejects.toBeInstanceOf(InvalidQuantityError);
      await expect(svc.convertToSold(TT, q)).rejects.toBeInstanceOf(InvalidQuantityError);
      await expect(svc.releaseSold(TT, q)).rejects.toBeInstanceOf(InvalidQuantityError);
    }
    expect(repo.reserve).not.toHaveBeenCalled();
    expect(repo.release).not.toHaveBeenCalled();
    expect(repo.convertToSold).not.toHaveBeenCalled();
    expect(repo.releaseSold).not.toHaveBeenCalled();
  });

  it('release and convertToSold move counters and surface state errors untouched', async () => {
    const { repo, state } = fakeRepo();
    const svc = createInventoryService(repo);
    await svc.hold(TT, 4);
    await svc.release(TT, 1);
    await svc.convertToSold(TT, 3);
    expect(state).toEqual({ total: 20, sold: 3, held: 0 });

    await expect(svc.release(TT, 1)).rejects.toBeInstanceOf(InventoryStateError);
    await expect(svc.convertToSold(TT, 1)).rejects.toBeInstanceOf(InventoryStateError);

    // A cancelled ticket leaves SOLD (never HELD) and cannot go below zero.
    await svc.releaseSold(TT, 2);
    expect(state).toEqual({ total: 20, sold: 1, held: 0 });
    await expect(svc.releaseSold(TT, 2)).rejects.toBeInstanceOf(InventoryStateError);
    expect(state.sold).toBe(1);
  });

  it('passes the caller transaction through to every repository call', async () => {
    const { repo } = fakeRepo();
    const svc = createInventoryService(repo);
    const tx = { marker: 'tx' } as unknown as DbExecutor;
    await svc.hold(TT, 2, tx);
    await svc.release(TT, 1, tx);
    await svc.convertToSold(TT, 1, tx);
    await svc.releaseSold(TT, 1, tx);
    expect(repo.reserve).toHaveBeenCalledWith(TT, 2, tx);
    expect(repo.release).toHaveBeenCalledWith(TT, 1, tx);
    expect(repo.convertToSold).toHaveBeenCalledWith(TT, 1, tx);
    expect(repo.releaseSold).toHaveBeenCalledWith(TT, 1, tx);
  });
});
