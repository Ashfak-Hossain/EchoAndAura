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
// server modules on reload and would leak a connection each time.
const g = globalThis as unknown as { __rateLimitStore?: RateLimitStore };
/**
 * Connects on the first hit, not when a route module loads: limiters are
 * built at module scope, and `next build` loads every route (ADR-036) —
 * it must not need Redis, nor open a connection it never uses. A missing
 * REDIS_URL then surfaces on that hit, through the limiter's `onError`.
 */
export function redisRateLimitStore(): RateLimitStore {
  const store = () =>
    (g.__rateLimitStore ??= createRedisRateLimitStore(
      createRedisConnection(process.env, 'limiter'),
    ));
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
export function withTimeout(store: RateLimitStore, ms: number): RateLimitStore {
  const capped = <T>(answer: Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`rate limiter: no answer in ${ms} ms`)), ms);
    });
    return Promise.race([answer, timeout]).finally(() => clearTimeout(timer));
  };
  return {
    hit: (key, windowSeconds) => capped(store.hit(key, windowSeconds)),
    peek: (key) => capped(store.peek(key)),
  };
}
