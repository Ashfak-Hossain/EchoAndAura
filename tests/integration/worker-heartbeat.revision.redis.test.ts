import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createRedisConnection } from '@/server/queue/connection';
import { assertWorkerRevision, recordWorkerRevision } from '@/server/queue/deployment-revision';
import { WORKER_HEARTBEAT_MAX_AGE_MS } from '@/server/queue/heartbeat';

const worker = createRedisConnection(process.env, 'worker');
const probe = createRedisConnection(process.env, 'probe');
afterAll(async () => {
  await Promise.all([worker, probe].map((r) => r.quit().catch(() => r.disconnect())));
});
describe('deployment evidence on real Redis', () => {
  it('requires two fresh matching revisions and expires both isolated records', async () => {
    const prefix = `echoandaura:test:revision:${randomBytes(6).toString('hex')}`;
    const keys = [`${prefix}:holds`, `${prefix}:orders`];
    const revision = 'a'.repeat(40);
    const now = Date.now();
    try {
      await expect(assertWorkerRevision(probe, revision, now, keys)).rejects.toThrow('unavailable');
      await recordWorkerRevision(worker, revision, keys[0], now);
      await expect(assertWorkerRevision(probe, revision, now, keys)).rejects.toThrow('unavailable');
      await recordWorkerRevision(worker, revision, keys[1], now);
      await expect(assertWorkerRevision(probe, revision, now, keys)).resolves.toBeUndefined();
      for (const key of keys) {
        expect(await probe.pttl(key)).toBeGreaterThan(WORKER_HEARTBEAT_MAX_AGE_MS);
        expect(await probe.pttl(key)).toBeLessThanOrEqual(2 * WORKER_HEARTBEAT_MAX_AGE_MS);
      }
      await recordWorkerRevision(worker, 'b'.repeat(40), keys[1], now);
      await expect(assertWorkerRevision(probe, revision, now, keys)).rejects.toThrow('unavailable');
      await recordWorkerRevision(worker, null, keys[1], now);
      await expect(assertWorkerRevision(probe, revision, now, keys)).rejects.toThrow('unavailable');
      await recordWorkerRevision(worker, revision, keys[1], now - WORKER_HEARTBEAT_MAX_AGE_MS - 1);
      await expect(assertWorkerRevision(probe, revision, now, keys)).rejects.toThrow('unavailable');
    } finally {
      await probe.del(...keys);
    }
  });
});
