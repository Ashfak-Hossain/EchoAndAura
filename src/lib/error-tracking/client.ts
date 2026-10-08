'use client';

import * as Sentry from '@sentry/nextjs';
import { errorRoute, errorTrackingOptions, privateTransport, sentryDsn } from './privacy';

const seen = new WeakSet<Error>();
let enabled = false;
let windowStarted = 0;
let sentInWindow = 0;

export function initializeBrowserErrorTracking(): void {
  const config = sentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);
  if (!config || process.env.NODE_ENV !== 'production') return;
  try {
    const revision = process.env.NEXT_PUBLIC_SOURCE_REVISION;
    Sentry.init({
      ...errorTrackingOptions(
        'browser',
        revision && /^[a-f0-9]{40}$/.test(revision) ? revision : null,
      ),
      dsn: config.dsn,
      enhanceFetchErrorMessages: false,
      integrations: [Sentry.globalHandlersIntegration(), Sentry.dedupeIntegration()],
      transport: (options: Parameters<typeof Sentry.makeFetchTransport>[0]) =>
        privateTransport(
          Sentry.makeFetchTransport({
            ...options,
            bufferSize: 20,
            fetchOptions: { referrerPolicy: 'no-referrer', credentials: 'omit' },
          }),
        ),
      beforeSend(event) {
        const now = Date.now();
        if (now - windowStarted >= 60_000) {
          windowStarted = now;
          sentInWindow = 0;
        }
        if (sentInWindow >= 20) return null;
        sentInWindow++;
        event.tags = { ...event.tags, route: errorRoute(window.location.pathname) };
        return errorTrackingOptions('browser', null).beforeSend(event);
      },
    });
    enabled = true;
  } catch {
    /* No telemetry failure may stop hydration or the offline scanner. */
  }
}

export function reportBoundaryError(error: Error & { digest?: string }): void {
  // The original server error is captured by onRequestError, not its masked client copy.
  if (!enabled || error.digest || seen.has(error)) return;
  seen.add(error);
  try {
    Sentry.captureException(error, { tags: { operation: 'render' } });
  } catch {
    /* Best effort only. */
  }
}
