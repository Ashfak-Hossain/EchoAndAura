/**
 * BullMQ worker entrypoint (a separate Node process: `pnpm worker`).
 *
 * It imports business logic from src/server/** directly and never from
 * next/* (CLAUDE.md). Jobs:
 *   - expire-holds (every minute, on its own `holds` queue and worker):
 *     ordersService.expireLapsedHolds — the only authority on the 20-minute
 *     hold (ADR-054, ADR-012).
 *   - email.<kind> ({ orderId }): render + send one transactional email
 *     through the configured Mailer, then write the audit row (ADR-016).
 *   - auth.sign-in ({ to, url }): a buyer's magic link.
 *   - auth.account (AccountEmail): an admin's password reset, new-email
 *     confirmation or email-change notice (ADR-038).
 *
 * The schedule is owned here, not by the app: upserting it on boot is
 * idempotent, so restarts and multiple workers never double-schedule.
 */
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { z } from 'zod';
import { ordersService, settingsService } from '@/server/container';
import { createEmailDispatcher, EmailSkippedError, emailSender } from '@/server/email/dispatch';
import { MailerPermanentError, MailerThrottledError } from '@/server/email/mailer';
import { emailKindOf, selectMailer } from '@/server/email/select';
import { logger } from '@/server/lib/logger';
import { createRedisConnection } from '@/server/queue/connection';
import { ORDERS_WORKER_HEARTBEAT_KEY, recordWorkerHeartbeat } from '@/server/queue/heartbeat';
import { createRevisionRecorder } from '@/server/queue/deployment-revision';
import { readImageRevision } from '@/server/lib/image-revision';
import { renderSignInEmail } from '@/server/email/templates/sign-in';
import { renderAccountEmail } from '@/server/email/templates/account';
import { EMAIL_CHANGE_TTL_SECONDS, PASSWORD_RESET_TTL_SECONDS } from '@/server/auth/account-emails';
import { MAGIC_LINK_TTL_SECONDS } from '@/server/auth/magic-link';
import {
  ACCOUNT_EMAIL_JOB,
  EXPIRE_HOLDS_EVERY_MS,
  EXPIRE_HOLDS_JOB,
  HOLDS_QUEUE,
  ORDERS_QUEUE,
  RELAY_ANNOUNCE_JOB,
  RELAY_QUEUE,
  SIGN_IN_JOB,
  WORKER_PING_JOB,
} from '@/server/queue/names';
import { RelayRejectedError, createRelayAnnouncer, readRelayConfig } from '@/server/relay/relay';
import { closeProducer } from '@/server/queue/producer';
import { ordersRepository } from '@/server/repositories/orders.repository';
import { ticketTypesRepository } from '@/server/repositories/ticket-types.repository';
import { siteUrl } from '@/lib/env.public';
import { FONT_DIR, missingFontFiles } from '@/server/pdf/ticket-pdf';

// Redis contents are external input: parse, never cast.
const emailJobData = z.object({ orderId: z.uuid() });
const signInJobData = z.object({ to: z.email(), url: z.url() });
// ADR-058: an announcement for the gate relay.
const relayJobData = z.object({
  eventId: z.uuid(),
  message: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('in'),
      ticketId: z.uuid(),
      at: z.iso.datetime(),
      gate: z.string().max(60).nullable(),
    }),
    z.object({ kind: z.literal('undo'), ticketId: z.uuid(), at: z.iso.datetime() }),
    z.object({ kind: z.literal('revoke'), passId: z.uuid(), until: z.iso.datetime() }),
  ]),
});
const accountEmailJobData = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('password-reset'), to: z.email(), url: z.url() }),
  z.object({ kind: z.literal('confirm-new-email'), to: z.email(), url: z.url() }),
  z.object({ kind: z.literal('email-change-notice'), to: z.email(), newEmail: z.email() }),
]);

async function main(): Promise<void> {
  // Fail at boot, not at the first ticket email: the deploy's smoke test
  // checks that the worker stays up, so this stops a bad image or
  // environment before it reaches production. selectMailer() below does the
  // same for the SES keys.
  const missing = missingFontFiles();
  if (missing.length > 0) {
    throw new Error(`ticket fonts missing in ${FONT_DIR}: ${missing.join(', ')}`);
  }
  const connection = createRedisConnection();
  const recordRevision = createRevisionRecorder(connection, readImageRevision(), () =>
    logger.warn('deployment revision evidence not recorded'),
  );
  const queue = new Queue(ORDERS_QUEUE, { connection });
  const mailer = selectMailer();
  const env = { siteUrl: siteUrl(), settings: () => settingsService.get() };
  const dispatcher = createEmailDispatcher({
    orders: ordersService,
    ordersRepo: ordersRepository,
    ticketTypes: ticketTypesRepository,
    mailer,
    env,
  });

  const holdsQueue = new Queue(HOLDS_QUEUE, { connection });
  // The schedule moved to its own queue (ADR-054): drop the one a worker
  // before this version left on the shared queue, or it would keep firing.
  await queue.removeJobScheduler(EXPIRE_HOLDS_JOB);
  await holdsQueue.upsertJobScheduler(
    EXPIRE_HOLDS_JOB,
    { every: EXPIRE_HOLDS_EVERY_MS },
    { name: EXPIRE_HOLDS_JOB, opts: { removeOnComplete: 100, removeOnFail: 500 } },
  );
  logger.info({ queue: HOLDS_QUEUE, everyMs: EXPIRE_HOLDS_EVERY_MS }, 'expire-holds scheduled');
  await queue.upsertJobScheduler(
    WORKER_PING_JOB,
    { every: EXPIRE_HOLDS_EVERY_MS },
    { name: WORKER_PING_JOB, opts: { removeOnComplete: 10, removeOnFail: 50 } },
  );

  const expireHolds = async () => {
    // Before the database work (ADR-040): the heartbeat says "the worker
    // picks up its jobs"; a Postgres outage is reported by the health
    // check's own database probe.
    await recordWorkerHeartbeat(connection);
    recordRevision('holds');
    const { expired, failed } = await ordersService.expireLapsedHolds();
    if (expired > 0 || failed > 0) logger.info({ expired, failed }, 'expire-holds run');
    // Skipped orders are logged individually; failing the job makes the
    // run visible in the queue's failed list too.
    if (failed > 0) throw new Error(`expire-holds: ${failed} order(s) could not be expired`);
    return { expired };
  };

  // One run at a time, no limiter: nothing else ever waits in front of it.
  const holdsWorker = new Worker(
    HOLDS_QUEUE,
    async (job) => {
      if (job.name === EXPIRE_HOLDS_JOB) return expireHolds();
      throw new Error(`unknown job ${job.name}`);
    },
    { connection, concurrency: 1 },
  );

  // ADR-058: gate relay announcements — one at a time, so they arrive in
  // the order they were committed; no limiter, nothing waits behind email.
  // Without RELAY_URL/RELAY_SECRET nothing is queued and no worker runs.
  const relayConfig = readRelayConfig();
  const relayAnnouncer = relayConfig ? createRelayAnnouncer(relayConfig) : null;
  const relayWorker = relayAnnouncer
    ? new Worker(
        RELAY_QUEUE,
        async (job) => {
          if (job.name !== RELAY_ANNOUNCE_JOB) throw new Error(`unknown job ${job.name}`);
          const data = relayJobData.parse(job.data);
          try {
            await relayAnnouncer.send(data.eventId, data.message);
          } catch (err: unknown) {
            if (err instanceof RelayRejectedError) throw new UnrecoverableError(err.message);
            throw err;
          }
        },
        { connection, concurrency: 1 },
      )
    : null;
  relayWorker?.on('failed', (job, err) =>
    logger.warn(
      { jobId: job?.id, attempt: job?.attemptsMade, err: err.message },
      'relay: announcement failed',
    ),
  );
  relayWorker?.on('error', (err) => logger.error({ err }, 'worker error'));

  const worker = new Worker(
    ORDERS_QUEUE,
    async (job) => {
      // A run the old schedule queued on this queue before the deploy.
      if (job.name === EXPIRE_HOLDS_JOB) return expireHolds();
      if (job.name === WORKER_PING_JOB) {
        await recordWorkerHeartbeat(connection, Date.now(), ORDERS_WORKER_HEARTBEAT_KEY);
        recordRevision('orders');
        return { ok: true };
      }

      if (job.name === SIGN_IN_JOB) {
        const parsed = signInJobData.safeParse(job.data);
        if (!parsed.success) throw new UnrecoverableError(`bad job data: ${parsed.error.message}`);
        const settings = await env.settings();
        const rendered = await renderSignInEmail({
          url: parsed.data.url,
          ...emailSender(env.siteUrl, settings),
          ttlMinutes: Math.round(MAGIC_LINK_TTL_SECONDS / 60),
        });
        try {
          const { messageId } = await mailer.send({
            to: parsed.data.to,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            replyTo: settings.supportEmail ?? undefined,
          });
          logger.info({ messageId }, 'sign-in email sent');
          return { messageId };
        } catch (err: unknown) {
          if (err instanceof MailerPermanentError) throw new UnrecoverableError(err.message);
          throw err;
        }
      }

      if (job.name === ACCOUNT_EMAIL_JOB) {
        const parsed = accountEmailJobData.safeParse(job.data);
        if (!parsed.success) throw new UnrecoverableError(`bad job data: ${parsed.error.message}`);
        const settings = await env.settings();
        const ttlSeconds =
          parsed.data.kind === 'password-reset'
            ? PASSWORD_RESET_TTL_SECONDS
            : EMAIL_CHANGE_TTL_SECONDS;
        const rendered = await renderAccountEmail({
          ...parsed.data,
          ...emailSender(env.siteUrl, settings),
          ttlMinutes: Math.round(ttlSeconds / 60),
        });
        try {
          const { messageId } = await mailer.send({
            to: parsed.data.to,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            replyTo: settings.supportEmail ?? undefined,
          });
          // The kind only: the address and the link stay out of the logs.
          logger.info({ messageId, kind: parsed.data.kind }, 'account email sent');
          return { messageId };
        } catch (err: unknown) {
          if (err instanceof MailerPermanentError) throw new UnrecoverableError(err.message);
          throw err;
        }
      }

      const kind = emailKindOf(job.name);
      if (kind) {
        const parsed = emailJobData.safeParse(job.data);
        if (!parsed.success) throw new UnrecoverableError(`bad job data: ${parsed.error.message}`);
        try {
          return await dispatcher.dispatch(kind, parsed.data.orderId);
        } catch (err: unknown) {
          // Wrong status is final, not a failure to retry.
          if (err instanceof EmailSkippedError) return { skipped: err.status };
          // Nor is a message the provider will never accept.
          if (err instanceof MailerPermanentError) throw new UnrecoverableError(err.message);
          throw err;
        }
      }

      throw new Error(`unknown job ${job.name}`);
    },
    {
      connection,
      concurrency: 2,
      // A steady pace for the provider (ADR-057); a burst past its quota is
      // throttled and retried, never dropped.
      limiter: { max: 5, duration: 1000 },
    },
  );

  worker.on('failed', (job, err) => {
    const throttled = err instanceof MailerThrottledError;
    logger[throttled ? 'warn' : 'error'](
      { jobId: job?.id, name: job?.name, attempt: job?.attemptsMade, err },
      throttled ? 'job throttled, will retry' : 'job failed',
    );
    // Final attempt of an email: leave the trace where Raj will look.
    const kind = job ? emailKindOf(job.name) : null;
    const data = emailJobData.safeParse(job?.data);
    const orderId = data.success ? data.data.orderId : null;
    const final =
      err instanceof UnrecoverableError || (job?.attemptsMade ?? 0) >= (job?.opts.attempts ?? 1);
    if (kind && orderId && job && final) {
      void ordersRepository
        .insertEvent({
          orderId,
          actor: 'system',
          action: 'email.failed',
          fromStatus: null,
          toStatus: null,
          note: `${kind}: ${err.message}`,
        })
        .catch((e: unknown) => logger.error({ orderId, err: e }, 'could not record email.failed'));
    }
  });
  // Without listeners BullMQ swallows these to console.error — outside pino.
  worker.on('error', (err) => logger.error({ err }, 'worker error'));
  queue.on('error', (err) => logger.error({ err }, 'queue error'));
  holdsWorker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, name: job?.name, err }, 'job failed'),
  );
  holdsWorker.on('error', (err) => logger.error({ err }, 'worker error'));
  holdsQueue.on('error', (err) => logger.error({ err }, 'queue error'));
  // At boot too, so /api/health is green within seconds of a deploy rather
  // than after the first scheduled run (the deploy smoke test waits for it).
  await Promise.all([
    worker.waitUntilReady(),
    holdsWorker.waitUntilReady(),
    relayWorker?.waitUntilReady(),
  ]);
  await Promise.all([
    recordWorkerHeartbeat(connection),
    recordWorkerHeartbeat(connection, Date.now(), ORDERS_WORKER_HEARTBEAT_KEY),
  ]);
  recordRevision('holds');
  recordRevision('orders');
  logger.info(
    { queues: [ORDERS_QUEUE, HOLDS_QUEUE, ...(relayWorker ? [RELAY_QUEUE] : [])] },
    'worker started',
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    // If Redis is down, close() would wait forever; the supervisor gets a
    // clean exit code either way.
    const deadline = setTimeout(() => process.exit(1), 10_000);
    deadline.unref();
    try {
      await Promise.all([worker.close(), holdsWorker.close(), relayWorker?.close()]);
      await Promise.all([queue.close(), holdsQueue.close()]);
      await closeProducer(); // this process enqueues too (expiry → C4)
      await connection.quit();
      process.exit(0);
    } catch (err: unknown) {
      logger.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((err: unknown) => {
  logger.error({ err }, 'worker failed to start');
  process.exit(1);
});
