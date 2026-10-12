import { describe, expect, it, vi } from 'vitest';
import type IORedis from 'ioredis';
import {
  createRateLimiter,
  createRedisAuthRateLimit,
  redisAuthRateLimit,
  type AuthRateLimitStorage,
  type RateLimitStore,
} from '@/server/lib/rate-limit';
import { logger } from '@/server/lib/logger';

vi.mock('@/server/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function memoryStore(): RateLimitStore & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    async hit(key) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return n;
    },
    async peek(key) {
      return counts.get(key) ?? 0;
    },
  };
}

describe('createRateLimiter', () => {
  it('allows up to the limit per subject, then refuses; subjects and scopes are separate', async () => {
    const limiter = createRateLimiter(memoryStore());
    const rule = { scope: 'sign-in:email', limit: 2, windowSeconds: 60 };
    expect(await limiter.allow([{ ...rule, subject: 'a@x.com' }])).toBe(true);
    expect(await limiter.allow([{ ...rule, subject: 'a@x.com' }])).toBe(true);
    expect(await limiter.allow([{ ...rule, subject: 'a@x.com' }])).toBe(false);
    expect(await limiter.allow([{ ...rule, subject: 'b@x.com' }])).toBe(true);
    expect(await limiter.allow([{ ...rule, scope: 'find-order', subject: 'a@x.com' }])).toBe(true);
  });

  it('refuses when any one rule is over, and every call counts against all of them', async () => {
    const store = memoryStore();
    const limiter = createRateLimiter(store);
    const rules = [
      { scope: 'ip', subject: '1.2.3.4', limit: 10, windowSeconds: 60 },
      { scope: 'email', subject: 'a@x.com', limit: 1, windowSeconds: 900 },
    ];
    expect(await limiter.allow(rules)).toBe(true);
    expect(await limiter.allow(rules)).toBe(false);
    expect(store.counts.get('ratelimit:ip:1.2.3.4')).toBe(2);
  });

  it('on a store failure, denies by default and allows only when told to', async () => {
    const refused = async (): Promise<never> => {
      throw new Error('ECONNREFUSED');
    };
    const broken: RateLimitStore = { hit: refused, peek: refused };
    const rule = { scope: 's', subject: 'x', limit: 5, windowSeconds: 60 };
    expect(await createRateLimiter(broken).allow([rule])).toBe(false);
    expect(await createRateLimiter(broken).check([rule])).toBe(false);
    expect(await createRateLimiter(broken, { onError: 'allow' }).allow([rule])).toBe(true);
    expect(await createRateLimiter(broken, { onError: 'allow' }).check([rule])).toBe(true);
  });

  it('check counts nothing and refuses once a rule is at its limit', async () => {
    const store = memoryStore();
    const limiter = createRateLimiter(store);
    const rule = { scope: 'failed', subject: 'a@x.com', limit: 2, windowSeconds: 60 };
    expect(await limiter.check([rule])).toBe(true);
    expect(await limiter.check([rule])).toBe(true);
    expect(store.counts.size).toBe(0);
    await limiter.allow([rule]);
    expect(await limiter.check([rule])).toBe(true);
    await limiter.allow([rule]);
    // Two failures spent a limit of two: the next attempt is refused.
    expect(await limiter.check([rule])).toBe(false);
    expect(store.counts.get('ratelimit:failed:a@x.com')).toBe(2);
  });
});

describe('withTimeout (ADR-038)', () => {
  const never: RateLimitStore = {
    hit: () => new Promise<never>(() => {}),
    peek: () => new Promise<never>(() => {}),
  };

  it('a store that never answers is cut off: a deny limiter refuses, an allow limiter lets through', async () => {
    const { withTimeout } = await import('@/server/lib/rate-limit');
    const rule = { scope: 's', subject: 'x', limit: 5, windowSeconds: 60 };
    const started = Date.now();
    expect(await createRateLimiter(withTimeout(never, 20), { onError: 'deny' }).allow([rule])).toBe(
      false,
    );
    expect(
      await createRateLimiter(withTimeout(never, 20), { onError: 'allow' }).allow([rule]),
    ).toBe(true);
    expect(await createRateLimiter(withTimeout(never, 20), { onError: 'deny' }).check([rule])).toBe(
      false,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('passes a prompt answer through untouched', async () => {
    const { withTimeout } = await import('@/server/lib/rate-limit');
    const store = withTimeout(memoryStore(), 1_000);
    expect(await store.hit('k', 60)).toBe(1);
    expect(await store.hit('k', 60)).toBe(2);
    expect(await store.peek('k')).toBe(2);
  });
});

/** The MULTI → INCR, EXPIRE NX, TTL chain, on a fake clock. */
function fakeRedis(now: () => number) {
  const keys = new Map<string, { count: number; expiresAt: number | null }>();
  const live = (k: string) => {
    const entry = keys.get(k);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= now()) keys.delete(k);
    return keys.get(k);
  };
  const redis = {
    multi() {
      const ops: (() => unknown)[] = [];
      const chain = {
        incr(k: string) {
          ops.push(() => {
            const entry = live(k) ?? { count: 0, expiresAt: null };
            entry.count += 1;
            keys.set(k, entry);
            return entry.count;
          });
          return chain;
        },
        expire(k: string, seconds: number, mode: 'NX') {
          ops.push(() => {
            const entry = live(k);
            if (!entry || (mode === 'NX' && entry.expiresAt !== null)) return 0;
            entry.expiresAt = now() + seconds * 1000;
            return 1;
          });
          return chain;
        },
        ttl(k: string) {
          ops.push(() => {
            const entry = live(k);
            if (!entry) return -2;
            return entry.expiresAt === null ? -1 : Math.ceil((entry.expiresAt - now()) / 1000);
          });
          return chain;
        },
        exec: async () => ops.map((op) => [null, op()]),
      };
      return chain;
    },
  };
  return { redis: redis as unknown as IORedis, keys };
}

describe("better-auth's shared limiter (ADR-070)", () => {
  it('allows max requests per window, then refuses with the seconds left', async () => {
    let clock = 0;
    const { redis, keys } = fakeRedis(() => clock);
    const storage = createRedisAuthRateLimit(redis);
    const rule = { window: 60, max: 3 };
    for (let i = 0; i < 3; i++)
      expect(await storage.consume('203.0.113.9/get-session', rule)).toEqual({
        allowed: true,
        retryAfter: null,
      });
    clock = 20_000;
    expect(await storage.consume('203.0.113.9/get-session', rule)).toEqual({
      allowed: false,
      retryAfter: 40,
    });
    // Its own namespace, and a refusal does not extend the window.
    expect([...keys.keys()]).toEqual(['ratelimit:better-auth:203.0.113.9/get-session']);
    clock = 60_000;
    expect(await storage.consume('203.0.113.9/get-session', rule)).toMatchObject({ allowed: true });
  });

  it('keeps keys apart', async () => {
    const storage = createRedisAuthRateLimit(fakeRedis(() => 0).redis);
    const rule = { window: 60, max: 1 };
    expect((await storage.consume('a', rule)).allowed).toBe(true);
    expect((await storage.consume('b', rule)).allowed).toBe(true);
    expect((await storage.consume('a', rule)).allowed).toBe(false);
  });

  it('refuses an unexpected Redis reply rather than guessing', async () => {
    const broken = {
      multi: () => {
        const chain = {
          incr: () => chain,
          expire: () => chain,
          ttl: () => chain,
          exec: async () => null,
        };
        return chain;
      },
    } as unknown as IORedis;
    await expect(
      createRedisAuthRateLimit(broken).consume('k', { window: 60, max: 1 }),
    ).rejects.toThrow('unexpected MULTI reply');
  });

  it('fails open, and says so, when Redis errors or does not answer in time', async () => {
    const failing: AuthRateLimitStorage = {
      consume: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    };
    expect(await redisAuthRateLimit(() => failing).consume('k', { window: 60, max: 1 })).toEqual({
      allowed: true,
      retryAfter: null,
    });
    const hanging: AuthRateLimitStorage = { consume: () => new Promise(() => {}) };
    expect(await redisAuthRateLimit(() => hanging, 5).consume('k', { window: 60, max: 1 })).toEqual(
      { allowed: true, retryAfter: null },
    );
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      expect.anything(),
      'auth rate limiter unavailable — allowing',
    );
  });

  it('passes a refusal through unchanged', async () => {
    const refusing: AuthRateLimitStorage = {
      consume: async () => ({ allowed: false, retryAfter: 12 }),
    };
    expect(await redisAuthRateLimit(() => refusing).consume('k', { window: 60, max: 1 })).toEqual({
      allowed: false,
      retryAfter: 12,
    });
  });
});
