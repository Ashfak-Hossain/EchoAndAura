/**
 * BullMQ worker entrypoint (a separate Node process: `pnpm worker`).
 *
 * It imports business logic from src/server/** directly and never from
 * next/* (CLAUDE.md). Jobs:
 *   - expire-holds (every minute): ordersService.expireLapsedHolds — the
 *     only authority on the 24h hold (ADR-012).
 *   - email.<kind> ({ orderId }): render + send one transactional email
 *     through the configured Mailer, then write the audit row (ADR-016).
 *
 * The schedule is owned here, not by the app: upserting it on boot is
 * idempotent, so restarts and multiple workers never double-schedule.
 */
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { z } from 'zod';
import { ordersService } from '@/server/container';
import { createEmailDispatcher, EmailSkippedError } from '@/server/email/dispatch';
import { MailerPermanentError, MailerThrottledError } from '@/server/email/mailer';
import { emailKindOf, selectMailer } from '@/server/email/select';
import { logger } from '@/server/lib/logger';
import { createRedisConnection } from '@/server/queue/connection';
import { EXPIRE_HOLDS_EVERY_MS, EXPIRE_HOLDS_JOB, ORDERS_QUEUE } from '@/server/queue/names';
import { closeProducer } from '@/server/queue/producer';
import { ordersRepository } from '@/server/repositories/orders.repository';
import { ticketTypesRepository } from '@/server/repositories/ticket-types.repository';
import {
  bkashReceiveNumber,
  organizerContactEmail,
  organizerPhone,
  siteUrl,
} from '@/lib/env.public';

// Redis contents are external input: parse, never cast.
const emailJobData = z.object({ orderId: z.uuid() });

async function main(): Promise<void> {
  const connection = createRedisConnection();
  const queue = new Queue(ORDERS_QUEUE, { connection });
  const dispatcher = createEmailDispatcher({
    orders: ordersService,
    ordersRepo: ordersRepository,
    ticketTypes: ticketTypesRepository,
    mailer: selectMailer(),
    env: {
      siteUrl: siteUrl(),
      bkashNumber: bkashReceiveNumber(),
      contactEmail: organizerContactEmail(),
      contactPhone: organizerPhone(),
    },
  });

  await queue.upsertJobScheduler(
    EXPIRE_HOLDS_JOB,
    { every: EXPIRE_HOLDS_EVERY_MS },
    { name: EXPIRE_HOLDS_JOB, opts: { removeOnComplete: 100, removeOnFail: 500 } },
  );
  logger.info({ queue: ORDERS_QUEUE, everyMs: EXPIRE_HOLDS_EVERY_MS }, 'expire-holds scheduled');

  const worker = new Worker(
    ORDERS_QUEUE,
    async (job) => {
      if (job.name === EXPIRE_HOLDS_JOB) {
        const { expired, failed } = await ordersService.expireLapsedHolds();
        if (expired > 0 || failed > 0) logger.info({ expired, failed }, 'expire-holds run');
        // Skipped orders are logged individually; failing the job makes
        // the run visible in the queue's failed list too.
        if (failed > 0) throw new Error(`expire-holds: ${failed} order(s) could not be expired`);
        return { expired };
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
      // Well under SES's default 14/s; the sandbox allows 1/s (ENVIRONMENT.md).
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
  logger.info({ queue: ORDERS_QUEUE }, 'worker started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    // If Redis is down, close() would wait forever; the supervisor gets a
    // clean exit code either way.
    const deadline = setTimeout(() => process.exit(1), 10_000);
    deadline.unref();
    try {
      await worker.close();
      await queue.close();
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
