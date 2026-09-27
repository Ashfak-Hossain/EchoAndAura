import type IORedis from 'ioredis';
import { createRedisConnection } from './connection';

/**
 * ADR-036: the health check's Redis probe. Its own connection: the
 * producer's refuses commands until connected (it must never make a
 * request wait), which would read as "down" on the first check after a
 * boot. Cached like the producer, so checks every minute reuse it.
 */
const g = globalThis as unknown as { __healthRedis?: IORedis };

export async function pingRedis(): Promise<void> {
  const redis = (g.__healthRedis ??= createRedisConnection(process.env, 'probe'));
  await redis.ping();
}
