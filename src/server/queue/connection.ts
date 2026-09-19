import IORedis from 'ioredis';

/**
 * One Redis connection factory for BullMQ. `maxRetriesPerRequest: null` is
 * what BullMQ requires for blocking commands. Built on demand so importing
 * a service never needs REDIS_URL (the app only enqueues; the worker
 * consumes).
 */
export function createRedisConnection(env: NodeJS.ProcessEnv = process.env): IORedis {
  const url = env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set — see docs/ENVIRONMENT.md');
  return new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
}
