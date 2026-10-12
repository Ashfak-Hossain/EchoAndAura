import type IORedis from 'ioredis';
import { createRedisConnection } from '@/server/queue/connection';
import { logger } from './logger';

/**
 * Fixed-window counter for the public endpoints that cost the client
 * money or leak by enumeration: a sign-in link is an outbound email, and
 * "find my order" is a free guess at a phone number. Redis is already here
 * for the queue, so the counter lives there and is shared by every app
 * instance. `INCR` + `EXPIRE` on first hit, `GET` for a check; nothing else.
 */
export interface RateLimitStore {
  /** Increments `key` and returns the new count; sets the TTL when the key is new. */
  hit(key: string, windowSeconds: number): Promise<number>;
  /** The count so far, without adding to it; 0 when the key is absent or expired. */
  peek(key: string): Promise<number>;
}

export interface RateLimitRule {
  /** Namespace so unrelated limits never share a counter. */
  scope: string;
  /** Who: an IP, an email — the caller normalises. */
  subject: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimiter {
  /** True when every rule still has room. Each call counts one attempt. */
  allow(rules: RateLimitRule[]): Promise<boolean>;
  /**
   * True when every rule has room for one more, counting nothing: for a
   * limit on failures, which the caller counts with `allow` only once it
   * knows the attempt failed.
   */
  check(rules: RateLimitRule[]): Promise<boolean>;
}

export function createRateLimiter(
  store: RateLimitStore,
  opts: { onError?: 'allow' | 'deny' } = {},
): RateLimiter {
  const onError = opts.onError ?? 'deny';
  const key = (r: RateLimitRule) => `ratelimit:${r.scope}:${r.subject}`;
  const guarded = async (run: () => Promise<boolean>): Promise<boolean> => {
    try {
      return await run();
    } catch (err: unknown) {
      // Redis down: the sign-in link could not be queued anyway, so a
      // refusal is honest; a lookup that only reads Postgres may proceed.
      logger.error(
        { err },
        `rate limiter unavailable — ${onError === 'allow' ? 'allowing' : 'refusing'}`,
      );
      return onError === 'allow';
    }
  };
  return {
    allow: (rules) =>
      guarded(async () => {
        const counts = await Promise.all(rules.map((r) => store.hit(key(r), r.windowSeconds)));
        return counts.every((count, i) => count <= rules[i]!.limit);
      }),
    // `<`, not `<=`: the attempt about to be made is number count + 1.
    check: (rules) =>
      guarded(async () => {
        const counts = await Promise.all(rules.map((r) => store.peek(key(r))));
        return counts.every((count, i) => count < rules[i]!.limit);
      }),
  };
}

export function createRedisRateLimitStore(redis: IORedis): RateLimitStore {
  return {
    async hit(key, windowSeconds) {
      const replies = await redis.multi().incr(key).expire(key, windowSeconds, 'NX').exec();
      const count: unknown = replies?.[0]?.[1];
      if (typeof count !== 'number') throw new Error('rate limiter: unexpected INCR reply');
      return count;
    },
    async peek(key) {
      const value = await redis.get(key);
      return value === null ? 0 : Number(value);
    },
  };
}

// Cached on globalThis like the producer queue: Next dev re-evaluates
// server modules on reload and would leak a connection each time. One
// connection serves both limiters below.
const g = globalThis as unknown as {
  __limiterRedis?: IORedis;
  __rateLimitStore?: RateLimitStore;
  __authRateLimit?: AuthRateLimitStorage;
};
const limiterRedis = () => (g.__limiterRedis ??= createRedisConnection(process.env, 'limiter'));

/**
 * Connects on the first hit, not when a route module loads: limiters are
 * built at module scope, and `next build` loads every route (ADR-036) —
 * it must not need Redis, nor open a connection it never uses. A missing
 * REDIS_URL then surfaces on that hit, through the limiter's `onError`.
 */
export function redisRateLimitStore(): RateLimitStore {
  const store = () => (g.__rateLimitStore ??= createRedisRateLimitStore(limiterRedis()));
  return withTimeout(
    {
      hit: (key, windowSeconds) => store().hit(key, windowSeconds),
      peek: (key) => store().peek(key),
    },
    HIT_TIMEOUT_MS,
  );
}

/**
 * The limiter's connection waits for Redis (so the first request after a
 * start is counted, not refused); this caps the wait, so a Redis outage
 * answers through the limiter's `onError` instead of hanging the request.
 */
export const HIT_TIMEOUT_MS = 2_000;
function capped<T>(answer: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`rate limiter: no answer in ${ms} ms`)), ms);
  });
  return Promise.race([answer, timeout]).finally(() => clearTimeout(timer));
}
export function withTimeout(store: RateLimitStore, ms: number): RateLimitStore {
  return {
    hit: (key, windowSeconds) => capped(store.hit(key, windowSeconds), ms),
    peek: (key) => capped(store.peek(key), ms),
  };
}

/**
 * better-auth's own limiter (rateLimit.customStorage, ADR-070). In memory,
 * every web instance would allow its own `max`; in Redis they share one
 * count. Structurally better-auth 1.7's BetterAuthRateLimitStorage.
 */
export interface AuthRateLimitStorage {
  consume(
    key: string,
    rule: { window: number; max: number },
  ): Promise<{ allowed: boolean; retryAfter: number | null }>;
}

/**
 * One atomic step, as better-auth requires: count the request and read the
 * window's remaining time together, so simultaneous requests cannot all
 * pass a stale read. The window starts at the first request and is never
 * extended (EXPIRE NX); refused requests still count inside it.
 */
export function createRedisAuthRateLimit(redis: IORedis): AuthRateLimitStorage {
  return {
    async consume(key, { window, max }) {
      const k = `ratelimit:better-auth:${key}`;
      const replies = await redis.multi().incr(k).expire(k, window, 'NX').ttl(k).exec();
      const count: unknown = replies?.[0]?.[1];
      const ttl: unknown = replies?.[2]?.[1];
      if (typeof count !== 'number' || typeof ttl !== 'number')
        throw new Error('rate limiter: unexpected MULTI reply');
      if (count <= max) return { allowed: true, retryAfter: null };
      return { allowed: false, retryAfter: ttl > 0 ? ttl : window };
    },
  };
}

/**
 * Lazy and time-capped like the store above, but fails open: it guards
 * better-auth's remaining HTTP routes (email-link verification, session
 * reads, sign-out), and refusing them would sign everyone out of a working
 * site over a Redis blip. Their tokens are long random values, and the
 * Cloudflare rule and Traefik's cap still stand in front (ADR-047).
 */
export function redisAuthRateLimit(
  storage: () => AuthRateLimitStorage = () =>
    (g.__authRateLimit ??= createRedisAuthRateLimit(limiterRedis())),
  ms = HIT_TIMEOUT_MS,
): AuthRateLimitStorage {
  return {
    async consume(key, rule) {
      try {
        return await capped(storage().consume(key, rule), ms);
      } catch (err: unknown) {
        logger.error({ err }, 'auth rate limiter unavailable — allowing');
        return { allowed: true, retryAfter: null };
      }
    },
  };
}
