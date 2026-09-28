import type IORedis from 'ioredis';
import { EXPIRE_HOLDS_EVERY_MS } from './names';

/**
 * ADR-040: the worker's proof of life for `/api/health`. Without it a dead
 * worker is invisible: the site still answers, but no email goes out and
 * no 24h hold is ever released. The worker writes the time when it starts
 * and at the start of every expire-holds run, so a fresh value means both
 * that the process is up and that its scheduled jobs are being picked up.
 */
export const WORKER_HEARTBEAT_KEY = 'echoandaura:worker:heartbeat';

/** Three missed runs, so a single late run (a deploy, a slow minute) is not an outage. */
export const WORKER_HEARTBEAT_MAX_AGE_MS = 3 * EXPIRE_HOLDS_EVERY_MS;

export async function recordWorkerHeartbeat(
  redis: Pick<IORedis, 'set'>,
  now: number = Date.now(),
  key: string = WORKER_HEARTBEAT_KEY,
): Promise<void> {
  // The key expires on its own a little after it goes stale, so a worker
  // that is gone for good leaves nothing behind.
  await redis.set(key, String(now), 'PX', 2 * WORKER_HEARTBEAT_MAX_AGE_MS);
}

/**
 * Web and worker share one host clock, so a timestamp from the future can
 * only be corruption or a clock jump: it is trusted no further than a
 * stale one.
 */
export function isHeartbeatFresh(
  value: string | null,
  now: number,
  maxAgeMs: number = WORKER_HEARTBEAT_MAX_AGE_MS,
): boolean {
  if (value === null) return false;
  const at = Number(value);
  if (!Number.isSafeInteger(at)) return false;
  return Math.abs(now - at) <= maxAgeMs;
}

/** A health probe: resolves when the heartbeat is fresh, throws otherwise. */
export async function assertWorkerAlive(
  redis: Pick<IORedis, 'get'>,
  now: number = Date.now(),
  key: string = WORKER_HEARTBEAT_KEY,
): Promise<void> {
  if (!isHeartbeatFresh(await redis.get(key), now)) {
    throw new Error('worker heartbeat missing or stale');
  }
}
