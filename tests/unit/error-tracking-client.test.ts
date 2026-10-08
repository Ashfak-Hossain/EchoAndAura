import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserOptions } from '@sentry/nextjs';
import type { ErrorEvent } from '@sentry/core';

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  globalHandlersIntegration: vi.fn(() => ({ name: 'GlobalHandlers' })),
  dedupeIntegration: vi.fn(() => ({ name: 'Dedupe' })),
  makeFetchTransport: vi.fn(),
}));
vi.mock('@sentry/nextjs', () => sdk);
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sdk.init.mockReset();
  sdk.captureException.mockReset();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', `https://${'a'.repeat(32)}@o123.ingest.us.sentry.io/123`);
  vi.stubEnv('NEXT_PUBLIC_SOURCE_REVISION', 'b'.repeat(40));
  vi.stubGlobal('window', { location: { pathname: '/bn/orders/private-order' } });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('browser errors', () => {
  it('captures an error boundary once and skips masked server errors', async () => {
    const client = await import('@/lib/error-tracking/client');
    client.initializeBrowserErrorTracking();
    const error = new Error('buyer@example.com');
    client.reportBoundaryError(error);
    client.reportBoundaryError(error);
    client.reportBoundaryError(
      Object.assign(new Error('masked server error'), { digest: '1234567' }),
    );
    expect(sdk.captureException).toHaveBeenCalledExactlyOnceWith(error, {
      tags: { operation: 'render' },
    });
  });
  it('initializes only when enabled in a production build', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    const client = await import('@/lib/error-tracking/client');
    client.initializeBrowserErrorTracking();
    client.reportBoundaryError(new Error('private'));
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', `https://${'a'.repeat(32)}@o123.ingest.us.sentry.io/123`);
    vi.stubEnv('NODE_ENV', 'development');
    client.initializeBrowserErrorTracking();
    expect(sdk.init).not.toHaveBeenCalled();
  });
  it('isolates initialization and capture failures from hydration and recovery', async () => {
    const client = await import('@/lib/error-tracking/client');
    sdk.init.mockImplementationOnce(() => {
      throw new Error('sdk failure');
    });
    expect(() => client.initializeBrowserErrorTracking()).not.toThrow();
    client.initializeBrowserErrorTracking();
    sdk.captureException.mockImplementationOnce(() => {
      throw new Error('vendor failure');
    });
    expect(() => client.reportBoundaryError(new Error('private'))).not.toThrow();
  });
  it('uses build-owned release, removes data and limits noisy pages to 20 reports per minute', async () => {
    const client = await import('@/lib/error-tracking/client');
    client.initializeBrowserErrorTracking();
    const options = sdk.init.mock.calls[0]?.[0] as BrowserOptions;
    expect(options.release).toBe('b'.repeat(40));
    expect(options.defaultIntegrations).toBe(false);
    const event: ErrorEvent = {
      type: undefined,
      event_id: 'a'.repeat(32),
      message: 'buyer@example.com',
      exception: { values: [{ type: 'Error', value: '01712345678' }] },
    };
    const safe = await options.beforeSend?.(event, {});
    expect(safe?.tags?.route).toBe('/orders/[id]');
    expect(JSON.stringify(safe)).not.toContain('buyer@example.com');
    expect(JSON.stringify(safe)).not.toContain('01712345678');
    for (let i = 1; i < 20; i++) expect(await options.beforeSend?.(event, {})).not.toBeNull();
    expect(await options.beforeSend?.(event, {})).toBeNull();
  });
});
