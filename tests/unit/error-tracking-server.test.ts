import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn().mockResolvedValue(true),
  makeNodeTransport: vi.fn(),
}));
vi.mock('@sentry/node', () => sdk);
vi.mock('@/server/lib/image-revision', () => ({ readImageRevision: () => 'b'.repeat(40) }));
const dsn = `https://${'a'.repeat(32)}@o123.ingest.us.sentry.io/123`;
const carrier = globalThis as typeof globalThis & { __echoAuraErrorTracking?: unknown };

beforeEach(() => {
  delete carrier.__echoAuraErrorTracking;
  vi.resetModules();
  vi.clearAllMocks();
  sdk.flush.mockResolvedValue(true);
  sdk.init.mockReset();
  vi.stubEnv('APP_ENV', 'production');
  vi.stubEnv('SENTRY_DSN', dsn);
});
afterEach(() => {
  delete carrier.__echoAuraErrorTracking;
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('server reporting is optional and isolated', () => {
  it.each(['', 'invalid'])(
    'missing or invalid DSN %s does not initialize or send',
    async (value) => {
      vi.stubEnv('SENTRY_DSN', value);
      const tracking = await import('@/server/lib/error-tracking');
      tracking.initializeErrorTracking('web');
      tracking.reportError(new Error('private'), 'render');
      expect(sdk.init).not.toHaveBeenCalled();
      expect(sdk.captureException).not.toHaveBeenCalled();
    },
  );
  it('is off outside production', async () => {
    vi.stubEnv('APP_ENV', 'test');
    const tracking = await import('@/server/lib/error-tracking');
    tracking.initializeErrorTracking('web');
    expect(sdk.init).not.toHaveBeenCalled();
  });
  it('does not let init or capture failures change application behavior', async () => {
    const tracking = await import('@/server/lib/error-tracking');
    sdk.init.mockImplementationOnce(() => {
      throw new Error('sdk unavailable');
    });
    expect(() => tracking.initializeErrorTracking('worker')).not.toThrow();
    tracking.initializeErrorTracking('worker');
    sdk.captureException.mockImplementationOnce(() => {
      throw new Error('vendor unavailable');
    });
    expect(() => tracking.reportError(new Error('private'), 'startup')).not.toThrow();
  });
  it('uses image-owned release metadata, static tags, weak dedupe and a bounded outage budget', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'));
    const tracking = await import('@/server/lib/error-tracking');
    tracking.initializeErrorTracking('web');
    expect(sdk.init.mock.calls[0]?.[0]).toMatchObject({
      release: 'b'.repeat(40),
      defaultIntegrations: false,
      tracesSampleRate: 0,
      enableLogs: false,
      enableOpenTelemetrySetup: false,
    });
    const error = new Error('buyer@example.com');
    tracking.reportError(error, 'payment.submit', { route: '/orders/private-id?token=secret' });
    tracking.reportError(error, 'payment.submit');
    tracking.reportError(new Error('other private'), 'payment.submit', {
      route: '/orders/another-id',
    });
    expect(sdk.captureException).toHaveBeenCalledTimes(1);
    expect(sdk.captureException.mock.calls[0]?.[1]).toEqual({
      tags: { operation: 'payment.submit', route: '/orders/[id]' },
    });
    vi.advanceTimersByTime(60_000);
    tracking.reportError(new Error('again'), 'payment.submit', { route: '/orders/new-id' });
    expect(sdk.captureException).toHaveBeenCalledTimes(2);
  });
  it('has a hard flush deadline even when the SDK never settles', async () => {
    vi.useFakeTimers();
    sdk.flush.mockImplementationOnce(() => new Promise(() => {}));
    const tracking = await import('@/server/lib/error-tracking');
    tracking.initializeErrorTracking('worker');
    const flushing = tracking.flushErrorTracking(50);
    await vi.advanceTimersByTimeAsync(50);
    await expect(flushing).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('shares initialization, dedupe and budget across separately compiled module copies', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'));
    const instrumentation = await import('@/server/lib/error-tracking');
    instrumentation.initializeErrorTracking('web');
    vi.resetModules();
    const action = await import('@/server/lib/error-tracking');
    const error = new Error('private');
    action.reportError(error, 'payment.submit');
    instrumentation.reportError(error, 'render');
    instrumentation.reportError(new Error('other private'), 'payment.submit');
    action.initializeErrorTracking('web');
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.captureException).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    instrumentation.reportError(new Error('again'), 'payment.submit');
    expect(sdk.captureException).toHaveBeenCalledTimes(2);
  });
});
