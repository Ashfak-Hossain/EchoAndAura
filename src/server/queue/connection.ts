import IORedis from 'ioredis';

/**
 * Redis connections for BullMQ. The worker's blocking connection needs
 * `maxRetriesPerRequest: null` (BullMQ requires it). The producer — the
 * app enqueuing after a commit — must never wait on Redis: it fails fast
 * so the after-commit hook logs and the order stands. Built on demand so
 * importing a service never needs REDIS_URL.
 */
export function createRedisConnection(
  env: NodeJS.ProcessEnv = process.env,
  role: 'worker' | 'producer' = 'worker',
): IORedis {
  const url = env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set — see docs/ENVIRONMENT.md');
  return role === 'worker'
    ? new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false })
    : new IORedis(url, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2_000,
      });
}
