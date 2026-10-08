import type { Instrumentation } from 'next';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { initializeErrorTracking } = await import('./server/lib/error-tracking');
      initializeErrorTracking('web');
    } catch {
      /* Monitoring must not prevent the server becoming ready. */
    }
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof error.digest === 'string' &&
    /^(?:NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK);/.test(error.digest)
  )
    return;
  try {
    const { reportError } = await import('./server/lib/error-tracking');
    reportError(error, context.routeType, { route: context.routePath });
  } catch {
    /* Never copy request paths, headers, or bodies into reports. */
  }
};
