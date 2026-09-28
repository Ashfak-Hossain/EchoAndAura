import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createRedisRateLimitStore } from '@/server/lib/rate-limit';
import { createRedisConnection } from '@/server/queue/connection';

/**
 * ADR-038: the limiter's first command after a start. It used the
 * producer's fail-fast connection, which refuses commands until connected,
 * so the first rate-limited request after every deploy was refused
 * ("Too many attempts"). Needs a real Redis (docker compose; CI has one).
 */
const opened: ReturnType<typeof createRedisConnection>[] = [];
const fresh = (role: 'limiter' | 'producer') => {
  const redis = createRedisConnection(process.env, role);
  opened.push(redis);
  return redis;
};
afterAll(async () => {
  await Promise.all(opened.map((r) => r.quit().catch(() => r.disconnect())));
});

describe('rate limiter on a real Redis', () => {
  it('a brand-new limiter connection counts its very first hit', async () => {
    const store = createRedisRateLimitStore(fresh('limiter'));
    const key = `ratelimit:test:${randomBytes(6).toString('hex')}`;
    expect(await store.hit(key, 30)).toBe(1);
    expect(await store.hit(key, 30)).toBe(2);
  });

  it('(why) the fail-fast producer connection refuses that same first command', async () => {
    const store = createRedisRateLimitStore(fresh('producer'));
    await expect(
      store.hit(`ratelimit:test:${randomBytes(6).toString('hex')}`, 30),
    ).rejects.toThrow();
  });
});
