import { randomBytes, randomInt } from 'node:crypto';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { afterAll, describe, expect, it } from 'vitest';
import { buildAuthOptions } from '@/lib/auth-options';
import { createRedisAuthRateLimit } from '@/server/lib/rate-limit';
import { createRedisConnection } from '@/server/queue/connection';

/**
 * ADR-070 on a real Redis (docker compose; CI has one): better-auth's limiter
 * counts in Redis, so two web instances share one limit. In memory each
 * instance allows its own, which two replicas would double.
 */
const redis = createRedisConnection(process.env, 'limiter');
afterAll(async () => {
  await redis.quit().catch(() => redis.disconnect());
});

const baseURL = process.env.BETTER_AUTH_URL ?? '';
const origin = baseURL ? new URL(baseURL).origin : '';

/** One "web instance": the app's real auth options, limiter switched on. */
function instance() {
  const options = buildAuthOptions({ disableSignUp: true });
  const rateLimit: BetterAuthOptions['rateLimit'] = {
    ...options.rateLimit,
    enabled: true,
    customRules: { '/get-session': { window: 60, max: 3 } },
  };
  return betterAuth({ ...options, rateLimit });
}

/** A browser at `ip`, behind Cloudflare's header, asking for its session. */
async function getSession(auth: ReturnType<typeof instance>, ip: string): Promise<number> {
  const response = await auth.handler(
    new Request(`${origin}/api/auth/get-session`, {
      headers: { 'x-forwarded-for': ip, origin },
    }),
  );
  return response.status;
}

const freshIp = () => `203.0.113.${randomInt(1, 255)}`;

describe("better-auth's limiter across instances (real Redis)", () => {
  it('shares one limit between two instances, counted in Redis', async () => {
    const [a, b] = [instance(), instance()];
    const ip = freshIp();
    const key = `ratelimit:better-auth:${ip}|/get-session`;
    await redis.del(key);
    const statuses = [];
    for (const auth of [a, b, a, b]) statuses.push(await getSession(auth, ip));
    expect(statuses).toEqual([200, 200, 200, 429]);
    // The evidence that the count lives in Redis, not in this process:
    // better-auth's memory store is shared by every instance in one process,
    // so two instances here cannot stand in for two replicas on their own.
    expect(await redis.get(key)).toBe('4');
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('counts per window: refused with the seconds left, then allowed again', async () => {
    const storage = createRedisAuthRateLimit(redis);
    const key = `test-${randomBytes(6).toString('hex')}`;
    const rule = { window: 2, max: 2 };
    expect((await storage.consume(key, rule)).allowed).toBe(true);
    expect((await storage.consume(key, rule)).allowed).toBe(true);
    const refused = await storage.consume(key, rule);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfter).toBeGreaterThanOrEqual(1);
    expect(refused.retryAfter).toBeLessThanOrEqual(2);
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    expect(await storage.consume(key, rule)).toEqual({ allowed: true, retryAfter: null });
  });
});
