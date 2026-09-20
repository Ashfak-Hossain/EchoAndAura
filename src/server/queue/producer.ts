import { Queue } from 'bullmq';
import { logger } from '@/server/lib/logger';
import type { EmailKind } from '@/server/email/templates/render';
import { createRedisConnection } from './connection';
import { EMAIL_JOB_PREFIX, ORDERS_QUEUE } from './names';

/**
 * The app's side of the queue: hand the worker a job after a commit.
 * The Queue is created on first use so builds and code paths that never
 * enqueue need no Redis. Failures are the caller's to log — an email that
 * could not be queued must never undo an order.
 */
// Cached on globalThis like db/client.ts: Next dev re-evaluates server
// modules on every reload and would otherwise leak a connection each time.
const g = globalThis as unknown as { __ordersProducerQueue?: Queue };
function getQueue(): Queue {
  return (g.__ordersProducerQueue ??= new Queue(ORDERS_QUEUE, {
    connection: createRedisConnection(process.env, 'producer'),
  }));
}

/** A request must never hang on Redis; past this the hook logs and moves on. */
export const ENQUEUE_TIMEOUT_MS = 3_000;

export interface EmailQueue {
  add(name: string, data: { orderId: string }, opts: Record<string, unknown>): Promise<unknown>;
}

export const EMAIL_JOB_OPTIONS = {
  attempts: 5,
  // Four waits between five attempts — 30 s, 60 s, 2 min, 4 min (~7.5 min in
  // all): a throttled provider clears well within that.
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: 500,
  removeOnFail: 1000,
};

export function emailJobName(kind: EmailKind): string {
  return `${EMAIL_JOB_PREFIX}${kind}`;
}

/**
 * A deterministic job id makes the first send of each kind idempotent: a
 * double enqueue (two hooks, a retry) collapses into one job. A re-send
 * asks for a fresh id explicitly. BullMQ forbids ':' in custom ids (it is
 * its own key separator), hence '__'.
 */
export function emailJobId(kind: EmailKind, orderId: string, resendAt?: number): string {
  const base = `${kind}__${orderId}`;
  return resendAt === undefined ? base : `${base}__${resendAt}`;
}

export async function enqueueEmail(
  kind: EmailKind,
  orderId: string,
  opts: { resend?: boolean; queue?: EmailQueue; timeoutMs?: number } = {},
): Promise<void> {
  const jobId = emailJobId(kind, orderId, opts.resend ? Date.now() : undefined);
  const q = opts.queue ?? getQueue();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`enqueue ${jobId} timed out`)),
      opts.timeoutMs ?? ENQUEUE_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([
      q.add(emailJobName(kind), { orderId }, { ...EMAIL_JOB_OPTIONS, jobId }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
  logger.debug({ kind, orderId, jobId }, 'email job enqueued');
}

export async function closeProducer(): Promise<void> {
  await g.__ordersProducerQueue?.close();
  g.__ordersProducerQueue = undefined;
}
