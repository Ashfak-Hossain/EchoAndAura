import type IORedis from 'ioredis';
import { createRedisConnection } from './connection';
import { assertWorkerAlive } from './heartbeat';

/**
 * ADR-036: the health check's Redis probes. Their own connection: the
 * producer's refuses commands until connected (it must never make a
 * request wait), which would read as "down" on the first check after a
 * boot. Cached like the producer, so checks every minute reuse it.
 */
const g = globalThis as unknown as { __healthRedis?: IORedis };
const probeConnection = () => (g.__healthRedis ??= createRedisConnection(process.env, 'probe'));

export async function pingRedis(): Promise<void> {
  await probeConnection().ping();
}

/** ADR-040: the worker wrote its heartbeat within the last few minutes. */
export async function probeWorker(): Promise<void> {
  await assertWorkerAlive(probeConnection());
}
