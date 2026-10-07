import type IORedis from 'ioredis';
import { z } from 'zod';
import { gitRevision } from '@/server/lib/image-revision';
import { WORKER_HEARTBEAT_MAX_AGE_MS } from './heartbeat';

export const WORKER_REVISION_KEYS = {
  holds: 'echoandaura:worker:revision:holds',
  orders: 'echoandaura:worker:revision:orders',
} as const;
type QueueRole = keyof typeof WORKER_REVISION_KEYS;
const evidence = z
  .object({ revision: gitRevision.nullable(), at: z.number().int().nonnegative().safe() })
  .strict();

export async function recordWorkerRevision(
  redis: Pick<IORedis, 'set'>,
  revision: string | null,
  key: string,
  now = Date.now(),
): Promise<void> {
  const value = evidence.parse({ revision, at: now });
  await redis.set(key, JSON.stringify(value), 'PX', 2 * WORKER_HEARTBEAT_MAX_AGE_MS);
}

/** Instrumentation cannot delay or fail business jobs; only a fixed warning leaves here. */
export function createRevisionRecorder(
  redis: Pick<IORedis, 'set'>,
  revision: string | null,
  onFailure: () => void,
) {
  return (role: QueueRole): void => {
    void recordWorkerRevision(redis, revision, WORKER_REVISION_KEYS[role]).catch(() => {
      try {
        onFailure();
      } catch {
        // Even a logging failure must not fail a business job.
      }
    });
  };
}

export function matchesWorkerRevision(
  value: string | null,
  revision: string,
  now: number,
): boolean {
  try {
    const parsed = evidence.safeParse(JSON.parse(value ?? 'null'));
    return (
      parsed.success &&
      parsed.data.revision === revision &&
      now >= parsed.data.at &&
      now - parsed.data.at <= WORKER_HEARTBEAT_MAX_AGE_MS
    );
  } catch {
    return false;
  }
}

export async function assertWorkerRevision(
  redis: Pick<IORedis, 'get'>,
  revision: string,
  now = Date.now(),
  keys: readonly string[] = Object.values(WORKER_REVISION_KEYS),
): Promise<void> {
  const values = await Promise.all(keys.map((key) => redis.get(key)));
  if (
    keys.length !== 2 ||
    new Set(keys).size !== 2 ||
    !values.every((value) => matchesWorkerRevision(value, revision, now))
  )
    throw new Error('Worker revision evidence unavailable');
}
