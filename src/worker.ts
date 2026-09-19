/**
 * BullMQ worker entrypoint (a separate Node process: `pnpm worker`).
 *
 * It imports business logic from src/server/** directly and never from
 * next/* (CLAUDE.md). Jobs:
 *   - expire-holds (every minute): ordersService.expireLapsedHolds — the
 *     only authority on the 24h hold (ADR-012).
 *   - Phase 4 adds the ticket-delivery email.
 *
 * The schedule is owned here, not by the app: upserting it on boot is
 * idempotent, so restarts and multiple workers never double-schedule.
 */
import { Queue, Worker } from 'bullmq';
import { ordersService } from '@/server/container';
import { logger } from '@/server/lib/logger';
import { createRedisConnection } from '@/server/queue/connection';
import { EXPIRE_HOLDS_EVERY_MS, EXPIRE_HOLDS_JOB, ORDERS_QUEUE } from '@/server/queue/names';

async function main(): Promise<void> {
  const connection = createRedisConnection();
  const queue = new Queue(ORDERS_QUEUE, { connection });

  await queue.upsertJobScheduler(
    EXPIRE_HOLDS_JOB,
    { every: EXPIRE_HOLDS_EVERY_MS },
    { name: EXPIRE_HOLDS_JOB, opts: { removeOnComplete: 100, removeOnFail: 500 } },
  );
  logger.info({ queue: ORDERS_QUEUE, everyMs: EXPIRE_HOLDS_EVERY_MS }, 'expire-holds scheduled');

  const worker = new Worker(
    ORDERS_QUEUE,
    async (job) => {
      switch (job.name) {
        case EXPIRE_HOLDS_JOB: {
          const { expired, failed } = await ordersService.expireLapsedHolds();
          if (expired > 0 || failed > 0) logger.info({ expired, failed }, 'expire-holds run');
          // Skipped orders are logged individually; failing the job makes
          // the run visible in the queue's failed list too.
          if (failed > 0) throw new Error(`expire-holds: ${failed} order(s) could not be expired`);
          return { expired };
        }
        default:
          throw new Error(`unknown job ${job.name}`);
      }
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, name: job?.name, err }, 'job failed');
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
