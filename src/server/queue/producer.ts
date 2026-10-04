import { Queue } from 'bullmq';
import { logger } from '@/server/lib/logger';
import type { AccountEmail } from '@/server/auth/account-emails';
import type { EmailKind } from '@/server/email/templates/render';
import { createRedisConnection } from './connection';
import type { RelayAnnouncementWire } from '@/server/relay/relay';
import {
  ACCOUNT_EMAIL_JOB,
  EMAIL_JOB_PREFIX,
  ORDERS_QUEUE,
  RELAY_ANNOUNCE_JOB,
  RELAY_QUEUE,
  SIGN_IN_JOB,
} from './names';

/**
 * The app's side of the queue: hand the worker a job after a commit.
 * The Queue is created on first use so builds and code paths that never
 * enqueue need no Redis. Failures are the caller's to log — an email that
 * could not be queued must never undo an order.
 */
// Cached on globalThis like db/client.ts: Next dev re-evaluates server
// modules on every reload and would otherwise leak a connection each time.
const g = globalThis as unknown as { __ordersProducerQueue?: Queue; __relayProducerQueue?: Queue };
function getQueue(): Queue {
  return (g.__ordersProducerQueue ??= new Queue(ORDERS_QUEUE, {
    connection: createRedisConnection(process.env, 'producer'),
  }));
}

/** A request must never hang on Redis; past this the hook logs and moves on. */
export const ENQUEUE_TIMEOUT_MS = 3_000;

export interface EmailQueue {
  add(
    name: string,
    data: { orderId: string } | { to: string; url: string } | AccountEmail,
    opts: Record<string, unknown>,
  ): Promise<unknown>;
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

/**
 * Magic-link sign-in email. Not tied to an order, so no dedupe id: every
 * request is a fresh link (the previous one is invalidated by better-auth).
 */
export async function enqueueSignInEmail(
  to: string,
  url: string,
  opts: { queue?: EmailQueue; timeoutMs?: number } = {},
): Promise<void> {
  const q = opts.queue ?? getQueue();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('enqueue sign-in email timed out')),
      opts.timeoutMs ?? ENQUEUE_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([
      q.add(
        SIGN_IN_JOB,
        { to, url },
        // The URL is a bearer token: do not keep it around once sent.
        { ...EMAIL_JOB_OPTIONS, attempts: 3, removeOnComplete: true },
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Admin account email (ADR-038). Like the sign-in link, most carry a bearer
 * URL, so the job is dropped once sent and there is no dedupe id: every
 * request is fresh (better-auth's newest token is the valid one).
 */
export async function enqueueAccountEmail(
  email: AccountEmail,
  opts: { queue?: EmailQueue; timeoutMs?: number } = {},
): Promise<void> {
  const q = opts.queue ?? getQueue();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`enqueue ${email.kind} email timed out`)),
      opts.timeoutMs ?? ENQUEUE_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([
      q.add(ACCOUNT_EMAIL_JOB, email, {
        ...EMAIL_JOB_OPTIONS,
        attempts: 3,
        removeOnComplete: true,
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function closeProducer(): Promise<void> {
  await Promise.all([g.__ordersProducerQueue?.close(), g.__relayProducerQueue?.close()]);
  g.__ordersProducerQueue = undefined;
  g.__relayProducerQueue = undefined;
}

export interface RelayQueue {
  add(name: string, data: RelayJob, opts: Record<string, unknown>): Promise<unknown>;
}

export interface RelayJob {
  eventId: string;
  message: RelayAnnouncementWire;
}

/**
 * A revoke must reach the room even after a long relay outage (a leaked
 * pass stays usable there until it does): 12 tries, ~2 hours in all.
 */
export const RELAY_REVOKE_JOB_OPTIONS = {
  attempts: 12,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: true,
  removeOnFail: 200,
};

export const RELAY_JOB_OPTIONS = {
  // Six tries over ~30 s (1, 2, 4, 8, 16 s): a relay blip passes; a revoke
  // that never lands would leave a leaked pass in the room.
  attempts: 6,
  backoff: { type: 'exponential' as const, delay: 1_000 },
  removeOnComplete: true,
  removeOnFail: 200,
};

/** ADR-058: after a door commit. The caller logs a failure; it never undoes the check-in. */
export async function enqueueRelayAnnounce(
  job: RelayJob,
  opts: { queue?: RelayQueue; timeoutMs?: number } = {},
): Promise<void> {
  const q =
    opts.queue ??
    (g.__relayProducerQueue ??= new Queue(RELAY_QUEUE, {
      connection: createRedisConnection(process.env, 'producer'),
    }));
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`enqueue relay ${job.message.kind} timed out`)),
      opts.timeoutMs ?? ENQUEUE_TIMEOUT_MS,
    );
  });
  try {
    const options = job.message.kind === 'revoke' ? RELAY_REVOKE_JOB_OPTIONS : RELAY_JOB_OPTIONS;
    await Promise.race([q.add(RELAY_ANNOUNCE_JOB, job, options), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
