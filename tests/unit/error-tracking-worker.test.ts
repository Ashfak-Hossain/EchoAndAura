import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';
const report = vi.hoisted(() => vi.fn());
vi.mock('@/server/lib/error-tracking', () => ({ reportError: report }));
import { isTerminalJobFailure, reportJobFailure } from '@/server/queue/error-tracking';
import { startShutdownDeadline } from '@/server/queue/shutdown-deadline';

afterEach(() => {
  vi.useRealTimers();
});

describe('completed worker failures', () => {
  it('ignores retries but reports final attempts, including terminal throttling', () => {
    report.mockClear();
    const error = new Error('private job data');
    reportJobFailure('orders', { attemptsMade: 1, opts: { attempts: 3 } }, error);
    expect(report).not.toHaveBeenCalled();
    reportJobFailure('orders', { attemptsMade: 3, opts: { attempts: 3 } }, error);
    expect(report).toHaveBeenCalledExactlyOnceWith(error, 'job.failed', { queue: 'orders' });
  });
  it('handles unrecoverable errors and single-attempt scheduled jobs without job payloads', () => {
    expect(
      isTerminalJobFailure(
        { attemptsMade: 1, opts: { attempts: 5 } },
        new UnrecoverableError('private'),
      ),
    ).toBe(true);
    expect(isTerminalJobFailure({ attemptsMade: 1, opts: {} }, new Error('private'))).toBe(true);
    expect(isTerminalJobFailure(undefined, new Error('private'))).toBe(false);
  });
});

describe('worker shutdown status', () => {
  it('retains a failure exit if required shutdown work has not completed by ten seconds', () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    startShutdownDeadline(exit);
    vi.advanceTimersByTime(9999);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
  it('does not let a hung reporter turn a clean close near the deadline into failure', () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const markClean = startShutdownDeadline(exit);
    vi.advanceTimersByTime(9500);
    markClean();
    // Reporting may still be waiting when the existing overall deadline wins.
    vi.advanceTimersByTime(500);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });
});
