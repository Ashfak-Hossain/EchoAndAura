'use server';

import { requireAdmin } from '@/lib/session';
import { diagnosticsEnabled, SyntheticTestError } from '@/lib/error-tracking/synthetic';
import { reportError } from '@/server/lib/error-tracking';
import { logger } from '@/server/lib/logger';
import { enqueueDiagnosticFailure } from '@/server/queue/producer';

/**
 * The error-tracking activation proof (docs/ERROR-TRACKING.md). Each action
 * raises a SyntheticTestError and touches no order, ticket or buyer. All are
 * refused unless ERROR_TRACKING_DIAGNOSTICS=1.
 */
export interface DiagnosticResult {
  ok: boolean;
  message: string;
}

const OFF: DiagnosticResult = {
  ok: false,
  message: 'Diagnostics are switched off (ERROR_TRACKING_DIAGNOSTICS).',
};

/** Who pressed which check goes to the log; never into the report itself. */
async function begin(check: string): Promise<boolean> {
  const session = await requireAdmin();
  if (!diagnosticsEnabled()) return false;
  logger.warn({ check, admin: session.email }, 'diagnostics: synthetic error triggered');
  return true;
}

/** Thrown past the action, so Next's request-error hook reports it (operation `action`). */
export async function throwUnhandledServerError(): Promise<DiagnosticResult> {
  if (!(await begin('server.unhandled'))) return OFF;
  throw new SyntheticTestError();
}

/**
 * Caught and reported the way the order actions report an unexpected failure.
 * Its own operation tag: an `action` tag on /admin would share the reporter's
 * one-per-minute budget with the unhandled check above and be dropped.
 */
export async function reportCaughtServerError(): Promise<DiagnosticResult> {
  if (!(await begin('server.caught'))) return OFF;
  try {
    throw new SyntheticTestError();
  } catch (error) {
    reportError(error, 'diagnostics', { route: '/admin/diagnostics' });
  }
  return { ok: true, message: 'Reported a caught server error.' };
}

/** One attempt, so the worker's first failure is terminal and reported (queue `orders`). */
export async function queueWorkerFailure(): Promise<DiagnosticResult> {
  if (!(await begin('worker.terminal'))) return OFF;
  try {
    await enqueueDiagnosticFailure();
  } catch (error) {
    const shape = error instanceof Error ? { name: error.name, message: error.message } : {};
    logger.error({ err: shape }, 'diagnostics: could not queue the worker failure');
    return { ok: false, message: 'Could not queue the job. Is Redis reachable?' };
  }
  return { ok: true, message: 'Queued a job the worker will fail once.' };
}
