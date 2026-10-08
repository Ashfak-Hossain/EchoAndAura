import { UnrecoverableError } from 'bullmq';
import { reportError } from '@/server/lib/error-tracking';

interface FailureJob {
  attemptsMade: number;
  opts: { attempts?: number };
}

/** BullMQ emits failed for retries too. Report once retries are exhausted, not every attempt. */
export function isTerminalJobFailure(job: FailureJob | undefined, error: Error): boolean {
  return (
    error instanceof UnrecoverableError ||
    (job !== undefined && job.attemptsMade >= (job.opts.attempts ?? 1))
  );
}

export function reportJobFailure(
  queue: 'orders' | 'holds' | 'relay',
  job: FailureJob | undefined,
  error: Error,
): void {
  if (isTerminalJobFailure(job, error)) reportError(error, 'job.failed', { queue });
}
