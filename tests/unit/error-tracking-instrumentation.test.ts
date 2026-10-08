import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ initialize: vi.fn(), report: vi.fn() }));
vi.mock('@/server/lib/error-tracking', () => ({
  initializeErrorTracking: mocks.initialize,
  reportError: mocks.report,
}));
import { register, onRequestError } from '@/instrumentation';
const request = {
  path: '/orders/private-id?token=secret',
  method: 'POST',
  headers: { Cookie: 'private', Authorization: 'private' },
};
const context = {
  routerKind: 'App Router' as const,
  routePath: '/orders/[id]',
  routeType: 'action' as const,
  renderSource: 'react-server-components' as const,
  revalidateReason: undefined,
  renderType: 'dynamic' as const,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.report.mockReset();
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
});
afterEach(() => vi.unstubAllEnvs());
describe('Next instrumentation', () => {
  it('initializes the web reporter and forwards only static route context, never request data', async () => {
    await register();
    expect(mocks.initialize).toHaveBeenCalledExactlyOnceWith('web');
    const error = new Error('private buyer message');
    await onRequestError(error, request, context);
    expect(mocks.report).toHaveBeenCalledExactlyOnceWith(error, 'action', {
      route: '/orders/[id]',
    });
  });
  it('ignores expected navigation control flow and unsupported runtimes', async () => {
    await onRequestError({ digest: 'NEXT_REDIRECT;push;/private;307;' }, request, context);
    await onRequestError({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }, request, context);
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await register();
    await onRequestError(new Error('private'), request, context);
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('never replaces the original request failure with a monitoring failure', async () => {
    mocks.report.mockImplementationOnce(() => {
      throw new Error('sdk failed');
    });
    await expect(onRequestError(new Error('original'), request, context)).resolves.toBeUndefined();
  });
});
