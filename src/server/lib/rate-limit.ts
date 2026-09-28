import type IORedis from 'ioredis';
import { createRedisConnection } from '@/server/queue/connection';
import { logger } from './logger';

/**
 * Fixed-window counter for the public endpoints that cost the client
 * money or leak by enumeration: a sign-in link is an outbound email, and
 * "find my order" is a free guess at a phone number. Redis is already here
 * for the queue, so the counter lives there and is shared by every app
 * instance. `INCR` + `EXPIRE` on first hit; nothing else.
 */
export interface RateLimitStore {
  /** Increments `key` and returns the new count; sets the TTL when the key is new. */
  hit(key: string, windowSeconds: number): Promise<number>;
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
}

export function createRateLimiter(
  store: RateLimitStore,
  opts: { onError?: 'allow' | 'deny' } = {},
): RateLimiter {
  const onError = opts.onError ?? 'deny';
  return {
    async allow(rules) {
      try {
        const counts = await Promise.all(
          rules.map((r) => store.hit(`ratelimit:${r.scope}:${r.subject}`, r.windowSeconds)),
        );
        return counts.every((count, i) => count <= rules[i]!.limit);
      } catch (err: unknown) {
        // Redis down: the sign-in link could not be queued anyway, so a
        // refusal is honest; a lookup that only reads Postgres may proceed.
        logger.error(
          { err },
          `rate limiter unavailable — ${onError === 'allow' ? 'allowing' : 'refusing'}`,
        );
        return onError === 'allow';
      }
    },
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
  return withTimeout(
    {
      hit: (key, windowSeconds) =>
        (g.__rateLimitStore ??= createRedisRateLimitStore(
          createRedisConnection(process.env, 'limiter'),
        )).hit(key, windowSeconds),
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
  return {
    hit(key, windowSeconds) {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`rate limiter: no answer in ${ms} ms`)), ms);
      });
      return Promise.race([store.hit(key, windowSeconds), timeout]).finally(() =>
        clearTimeout(timer),
      );
    },
  };
}
