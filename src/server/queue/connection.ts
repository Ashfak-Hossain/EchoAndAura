import IORedis from 'ioredis';

/**
 * Redis connections for BullMQ. The worker's blocking connection needs
 * `maxRetriesPerRequest: null` (BullMQ requires it). The producer — the
 * app enqueuing after a commit — must never wait on Redis: it fails fast
 * so the after-commit hook logs and the order stands. The health probe
 * sits in between (ADR-036). Built on demand so
 * importing a service never needs REDIS_URL.
 */
export function createRedisConnection(
  env: NodeJS.ProcessEnv = process.env,
  role: 'worker' | 'producer' | 'probe' = 'worker',
): IORedis {
  const url = env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set — see docs/ENVIRONMENT.md');
  if (role === 'worker') {
    return new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
  }
  if (role === 'probe') {
    // The health check (ADR-036): waits for a connection like any client;
    // the service's own timeout decides when "slow" means "down".
    return new IORedis(url, { maxRetriesPerRequest: 1, connectTimeout: 2_000 });
  }
  return new IORedis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
  });
}
