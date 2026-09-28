import IORedis from 'ioredis';

/**
 * Redis connections for BullMQ. The worker's blocking connection needs
 * `maxRetriesPerRequest: null` (BullMQ requires it). The producer — the
 * app enqueuing after a commit — must never wait on Redis: it fails fast
 * so the after-commit hook logs and the order stands. The health probe
 * and the rate limiter sit in between (ADR-036, ADR-038). Built on demand so
 * importing a service never needs REDIS_URL.
 */
export function createRedisConnection(
  env: NodeJS.ProcessEnv = process.env,
  role: 'worker' | 'producer' | 'probe' | 'limiter' = 'worker',
): IORedis {
  const url = env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set — see docs/ENVIRONMENT.md');
  if (role === 'worker') {
    return new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
  }
  if (role === 'probe' || role === 'limiter') {
    // The health check (ADR-036) and the rate limiter: wait for the
    // connection like any client; the caller's own timeout decides when
    // "slow" means "down". Not the producer's fail-fast options: those
    // refuse every command until connected, so the first rate-limited
    // request after each start was refused (found 2026-09-28, ADR-038).
    return new IORedis(url, { maxRetriesPerRequest: 1, connectTimeout: 2_000 });
  }
  return new IORedis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
  });
}
