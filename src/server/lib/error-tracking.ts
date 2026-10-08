import * as Sentry from '@sentry/node';
import {
  errorRoute,
  errorTrackingOptions,
  privateTransport,
  sentryDsn,
  type ErrorOperation,
} from '@/lib/error-tracking/privacy';
import { readImageRevision } from './image-revision';

type TrackingState = {
  enabled: boolean;
  seen: WeakSet<object>;
  budget: Map<string, number>;
};
// Next compiles instrumentation and server actions into separate module graphs.
// Their adapter copies must share initialization, dedupe and the outage budget.
const carrier = globalThis as typeof globalThis & {
  __echoAuraErrorTracking?: TrackingState;
};
const state = (carrier.__echoAuraErrorTracking ??= {
  enabled: false,
  seen: new WeakSet<object>(),
  budget: new Map<string, number>(),
});

export function initializeErrorTracking(component: 'web' | 'worker'): void {
  if (state.enabled) return;
  const config = sentryDsn(process.env.SENTRY_DSN);
  if (!config || process.env.APP_ENV !== 'production') return;
  try {
    Sentry.init({
      ...errorTrackingOptions(component, readImageRevision()),
      dsn: config.dsn,
      enableOpenTelemetrySetup: false,
      transport: (options) =>
        privateTransport(Sentry.makeNodeTransport({ ...options, bufferSize: 20 })),
    });
    state.enabled = true;
  } catch {
    /* Optional telemetry must not prevent boot. */
  }
}

/** Only call in controllers after a service returns/throws, or completed-job listeners; never inside a transaction. */
export function reportError(
  error: unknown,
  operation: ErrorOperation,
  details: { route?: string; queue?: 'orders' | 'holds' | 'relay' } = {},
): void {
  if (!state.enabled) return;
  try {
    if (typeof error === 'object' && error !== null) {
      if (state.seen.has(error)) return;
      state.seen.add(error);
    }
    const key = `${operation}:${details.queue ?? ''}:${details.route ? errorRoute(details.route) : ''}`;
    const now = Date.now();
    // Bounded keys (operation/queue/static route), one report per key per minute during an outage.
    if (now - (state.budget.get(key) ?? 0) < 60_000) return;
    state.budget.set(key, now);
    Sentry.captureException(error, {
      tags: {
        operation,
        ...(details.route ? { route: errorRoute(details.route) } : {}),
        ...(details.queue ? { queue: details.queue } : {}),
      },
    });
  } catch {
    /* The original result and worker retry policy always win. */
  }
}

/** Keep a real deadline even if the SDK/transport never settles. */
export async function flushErrorTracking(timeoutMs = 2000): Promise<void> {
  if (!state.enabled) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Sentry.flush(timeoutMs),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch {
    /* Dropping telemetry is safer than blocking shutdown. */
  } finally {
    if (timer) clearTimeout(timer);
  }
}
