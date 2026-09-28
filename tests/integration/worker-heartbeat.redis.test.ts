import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createRedisConnection } from '@/server/queue/connection';
import {
  WORKER_HEARTBEAT_MAX_AGE_MS,
  assertWorkerAlive,
  recordWorkerHeartbeat,
} from '@/server/queue/heartbeat';

/**
 * ADR-040 on a real Redis: the worker writes with its own connection role,
 * the health check reads with the probe's, as in production. Needs a real
 * Redis (docker compose; CI has one).
 */
const worker = createRedisConnection(process.env, 'worker');
const probe = createRedisConnection(process.env, 'probe');
afterAll(async () => {
  await Promise.all([worker, probe].map((r) => r.quit().catch(() => r.disconnect())));
});

describe('worker heartbeat on a real Redis', () => {
  it('a heartbeat the worker just wrote reads as alive; with no heartbeat, it reads as down', async () => {
    const key = `echoandaura:test:heartbeat:${randomBytes(6).toString('hex')}`;
    // The heartbeat's own error, not a connection error: Redis must be up for this to mean anything.
    await expect(assertWorkerAlive(probe, Date.now(), key)).rejects.toThrow(/missing or stale/);
    await recordWorkerHeartbeat(worker, Date.now(), key);
    await expect(assertWorkerAlive(probe, Date.now(), key)).resolves.toBeUndefined();
  });

  it('the key expires on its own', async () => {
    const key = `echoandaura:test:heartbeat:${randomBytes(6).toString('hex')}`;
    await recordWorkerHeartbeat(worker, Date.now(), key);
    const ttl = await probe.pttl(key);
    expect(ttl).toBeGreaterThan(WORKER_HEARTBEAT_MAX_AGE_MS);
    expect(ttl).toBeLessThanOrEqual(2 * WORKER_HEARTBEAT_MAX_AGE_MS);
    await probe.del(key);
  });
});
