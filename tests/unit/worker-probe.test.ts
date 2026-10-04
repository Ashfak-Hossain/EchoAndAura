import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORDERS_WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_KEY } from '@/server/queue/heartbeat';

// The probe's Redis connection, as a plain map of keys.
const keys = new Map<string, string>();
vi.mock('@/server/queue/connection', () => ({
  createRedisConnection: () => ({ get: async (k: string) => keys.get(k) ?? null }),
}));

const { probeWorker } = await import('@/server/queue/probe');

describe('probeWorker (ADR-040, ADR-054)', () => {
  beforeEach(() => keys.clear());

  it('is healthy only when both the expiry and the email worker beat recently', async () => {
    keys.set(WORKER_HEARTBEAT_KEY, String(Date.now()));
    keys.set(ORDERS_WORKER_HEARTBEAT_KEY, String(Date.now()));
    await expect(probeWorker()).resolves.toBeUndefined();
  });

  it('fails when the email worker is silent, even if expiry still runs', async () => {
    keys.set(WORKER_HEARTBEAT_KEY, String(Date.now()));
    keys.set(ORDERS_WORKER_HEARTBEAT_KEY, String(Date.now() - 10 * 60_000));
    await expect(probeWorker()).rejects.toThrow(/stale/);
  });

  it('fails when the expiry worker is silent, even if emails still go out', async () => {
    keys.set(ORDERS_WORKER_HEARTBEAT_KEY, String(Date.now()));
    await expect(probeWorker()).rejects.toThrow(/stale/);
  });
});
