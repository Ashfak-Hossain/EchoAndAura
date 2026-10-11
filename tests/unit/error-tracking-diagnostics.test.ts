import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { diagnosticsEnabled, SyntheticTestError } from '@/lib/error-tracking/synthetic';
import { privateErrorEvent } from '@/lib/error-tracking/privacy';
import { isTerminalJobFailure } from '@/server/queue/error-tracking';
import { DIAGNOSTIC_FAILURE_JOB } from '@/server/queue/names';

const mocks = vi.hoisted(() => ({
  report: vi.fn(),
  enqueue: vi.fn(),
  requireAdmin: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/server/lib/error-tracking', () => ({ reportError: mocks.report }));
vi.mock('@/server/lib/logger', () => ({ logger: { warn: mocks.warn, error: mocks.error } }));
vi.mock('@/lib/session', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));
vi.mock('@/server/queue/producer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/queue/producer')>()),
  enqueueDiagnosticFailure: mocks.enqueue,
}));
const actions = await import('@/app/admin/(protected)/diagnostics/actions');
const { default: DiagnosticsPage } = await import('@/app/admin/(protected)/diagnostics/page');
const producer =
  await vi.importActual<typeof import('@/server/queue/producer')>('@/server/queue/producer');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ email: 'admin@example.test' });
  mocks.enqueue.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the diagnostics switch', () => {
  it('is on only for exactly "1"', () => {
    expect(diagnosticsEnabled({ ERROR_TRACKING_DIAGNOSTICS: '1' })).toBe(true);
    for (const value of [undefined, '', '0', 'true', 'yes', ' 1'])
      expect(diagnosticsEnabled({ ERROR_TRACKING_DIAGNOSTICS: value })).toBe(false);
  });
  it('hides the page and refuses every action while off, after the admin check', async () => {
    vi.stubEnv('ERROR_TRACKING_DIAGNOSTICS', '');
    expect(() => DiagnosticsPage()).toThrow('not found');
    for (const action of [
      actions.throwUnhandledServerError,
      actions.reportCaughtServerError,
      actions.queueWorkerFailure,
    ])
      expect(await action()).toEqual({ ok: false, message: expect.stringContaining('off') });
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(3);
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });
  it('requires an admin before anything else', async () => {
    vi.stubEnv('ERROR_TRACKING_DIAGNOSTICS', '1');
    mocks.requireAdmin.mockRejectedValue(new Error('redirect:/admin/login'));
    await expect(actions.reportCaughtServerError()).rejects.toThrow('redirect:/admin/login');
    await expect(actions.queueWorkerFailure()).rejects.toThrow('redirect:/admin/login');
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});

describe('where the switch reaches', () => {
  it('is passed to the web container only, off unless Dokploy sets it', () => {
    const compose = parse(readFileSync('docker-compose.prod.yml', 'utf8'), { merge: true });
    expect(compose.services.web.environment.ERROR_TRACKING_DIAGNOSTICS).toBe(
      '${ERROR_TRACKING_DIAGNOSTICS:-}',
    );
    expect(compose.services.worker.environment.ERROR_TRACKING_DIAGNOSTICS).toBeUndefined();
    expect(compose.services.migrate.environment.ERROR_TRACKING_DIAGNOSTICS).toBeUndefined();
  });
});

describe('the checks, switched on', () => {
  beforeEach(() => vi.stubEnv('ERROR_TRACKING_DIAGNOSTICS', '1'));

  it('throws the synthetic error past the action for the request-error hook', async () => {
    await expect(actions.throwUnhandledServerError()).rejects.toBeInstanceOf(SyntheticTestError);
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(
      { check: 'server.unhandled', admin: 'admin@example.test' },
      expect.any(String),
    );
  });
  it('reports a caught error under its own operation, so it never shares the action budget', async () => {
    expect(await actions.reportCaughtServerError()).toMatchObject({ ok: true });
    expect(mocks.report).toHaveBeenCalledExactlyOnceWith(
      expect.any(SyntheticTestError),
      'diagnostics',
      { route: '/admin/diagnostics' },
    );
  });
  it('queues the worker failure, and says so plainly when Redis is unreachable', async () => {
    expect(await actions.queueWorkerFailure()).toMatchObject({ ok: true });
    expect(mocks.enqueue).toHaveBeenCalledOnce();
    mocks.enqueue.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    expect(await actions.queueWorkerFailure()).toEqual({
      ok: false,
      message: expect.stringContaining('Redis'),
    });
    expect(mocks.error).toHaveBeenCalledOnce();
  });
});

describe('the worker failure job', () => {
  it('has one attempt and no payload, so its first failure is the reported terminal one', async () => {
    const calls: unknown[][] = [];
    await producer.enqueueDiagnosticFailure({
      queue: { add: async (...args: unknown[]) => void calls.push(args) },
    });
    expect(calls).toEqual([
      [DIAGNOSTIC_FAILURE_JOB, {}, { attempts: 1, removeOnComplete: true, removeOnFail: true }],
    ]);
    const opts = calls[0]?.[2] as { attempts: number };
    expect(isTerminalJobFailure({ attemptsMade: 1, opts }, new SyntheticTestError())).toBe(true);
  });
  it('gives up on a stuck queue instead of hanging the admin request', async () => {
    await expect(
      producer.enqueueDiagnosticFailure({
        queue: { add: () => new Promise<never>(() => {}) },
        timeoutMs: 5,
      }),
    ).rejects.toThrow('timed out');
  });
});

describe('what a synthetic report keeps', () => {
  it('keeps the class name, generic message and diagnostics tag; nothing else', () => {
    const error = new SyntheticTestError();
    expect(error.name).toBe('SyntheticTestError');
    const result = privateErrorEvent({
      event_id: 'a'.repeat(32),
      tags: { component: 'web', operation: 'diagnostics', route: '/admin', admin: 'x@y.test' },
      user: { email: 'admin@example.test' },
      exception: { values: [{ type: 'SyntheticTestError', value: 'admin@example.test' }] },
    });
    expect(result?.exception?.values?.[0]?.type).toBe('SyntheticTestError');
    expect(result?.tags).toMatchObject({ operation: 'diagnostics', route: '/admin' });
    expect(JSON.stringify(result)).not.toContain('example.test');
    expect(JSON.stringify(result)).not.toContain('y.test');
  });
});
