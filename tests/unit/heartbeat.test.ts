import { describe, expect, it } from 'vitest';
import {
  WORKER_HEARTBEAT_MAX_AGE_MS,
  assertWorkerAlive,
  isHeartbeatFresh,
  recordWorkerHeartbeat,
} from '@/server/queue/heartbeat';

const NOW = 1_790_000_000_000;
const MAX = WORKER_HEARTBEAT_MAX_AGE_MS;

describe('worker heartbeat freshness (ADR-040)', () => {
  it('is three expire-holds runs long', () => {
    expect(MAX).toBe(180_000);
  });

  it('a heartbeat from just now is fresh', () => {
    expect(isHeartbeatFresh(String(NOW - 1_000), NOW)).toBe(true);
  });

  it('exactly the maximum age still counts; one millisecond more does not', () => {
    expect(isHeartbeatFresh(String(NOW - MAX), NOW)).toBe(true);
    expect(isHeartbeatFresh(String(NOW - MAX - 1), NOW)).toBe(false);
  });

  it('no heartbeat at all means the worker never started or has been gone a while', () => {
    expect(isHeartbeatFresh(null, NOW)).toBe(false);
  });

  it('garbage in the key is not a heartbeat', () => {
    for (const bad of ['', 'abc', '12.5', 'NaN', 'Infinity', '1e400']) {
      expect(isHeartbeatFresh(bad, NOW)).toBe(false);
    }
  });

  it('a timestamp far in the future is trusted no more than a stale one', () => {
    expect(isHeartbeatFresh(String(NOW + 1_000), NOW)).toBe(true);
    expect(isHeartbeatFresh(String(NOW + MAX + 1), NOW)).toBe(false);
  });
});

describe('recording and probing the heartbeat', () => {
  function fakeRedis() {
    const store = new Map<string, string>();
    const calls: unknown[][] = [];
    return {
      calls,
      set: async (...args: unknown[]) => {
        calls.push(args);
        store.set(String(args[0]), String(args[1]));
        return 'OK' as const;
      },
      get: async (key: string) => store.get(key) ?? null,
    };
  }

  it('writes the time with an expiry, so a worker gone for good leaves nothing behind', async () => {
    const redis = fakeRedis();
    await recordWorkerHeartbeat(redis as never, NOW, 'k');
    expect(redis.calls).toEqual([['k', String(NOW), 'PX', 2 * MAX]]);
  });

  it('the probe resolves on a fresh heartbeat', async () => {
    const redis = fakeRedis();
    await recordWorkerHeartbeat(redis as never, NOW, 'k');
    await expect(assertWorkerAlive(redis as never, NOW + 60_000, 'k')).resolves.toBeUndefined();
  });

  it('the probe throws when the heartbeat is stale or missing', async () => {
    const redis = fakeRedis();
    await expect(assertWorkerAlive(redis as never, NOW, 'k')).rejects.toThrow(/missing or stale/);
    await recordWorkerHeartbeat(redis as never, NOW, 'k');
    await expect(assertWorkerAlive(redis as never, NOW + MAX + 1, 'k')).rejects.toThrow();
  });
});
