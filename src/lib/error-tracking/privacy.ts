import type {
  DataCollection,
  Envelope,
  ErrorEvent,
  Event,
  EventEnvelope,
  StackFrame,
  Transport,
} from '@sentry/core';

export type ErrorComponent = 'browser' | 'web' | 'worker';
export type ErrorOperation =
  | 'render'
  | 'route'
  | 'action'
  | 'proxy'
  | 'payment.submit'
  | 'admin.order'
  | 'job.failed'
  | 'queue.error'
  | 'startup'
  | 'shutdown'
  | 'fatal';
const components = new Set(['browser', 'web', 'worker']);
const operations = new Set([
  'render',
  'route',
  'action',
  'proxy',
  'payment.submit',
  'admin.order',
  'job.failed',
  'queue.error',
  'startup',
  'shutdown',
  'fatal',
]);
const queues = new Set(['orders', 'holds', 'relay']);
const routes = new Set([
  '/',
  '/events/[slug]',
  '/orders/[id]',
  '/tickets/[code]',
  '/admin',
  '/admin/orders/[id]',
  '/door',
  '/auth',
  'unknown',
]);
const types = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'AggregateError',
  'PostgresError',
  'UnrecoverableError',
  'InventoryStateError',
  'AttendeeNamesMismatchError',
  'TicketCodeCollisionError',
]);

/** Hosted HTTPS ingest only. Never turn a malformed DSN into a CSP wildcard. */
export function sentryDsn(value: string | undefined): { dsn: string; origin: string } | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.password ||
      url.search ||
      url.hash ||
      !/^[a-f0-9]{32}$/.test(url.username) ||
      !/^\/\d+$/.test(url.pathname) ||
      !/^o\d+\.ingest(?:\.(?:us|de))?\.sentry\.io$/.test(url.hostname)
    )
      return null;
    return { dsn: url.href, origin: url.origin };
  } catch {
    return null;
  }
}

/** Never retain raw paths: IDs, slugs, query strings and fragments are private. */
export function errorRoute(path: string): string {
  const clean = path.split(/[?#]/, 1)[0]?.replace(/^\/bn(?=\/|$)/, '') || '/';
  if (routes.has(clean)) return clean;
  if (/^\/admin\/orders\//.test(clean)) return '/admin/orders/[id]';
  if (/^\/admin(?:\/|$)/.test(clean)) return '/admin';
  if (/^\/door(?:\/|$)/.test(clean)) return '/door';
  if (/^\/events\//.test(clean)) return '/events/[slug]';
  if (/^\/orders\//.test(clean)) return '/orders/[id]';
  if (/^\/tickets\//.test(clean)) return '/tickets/[code]';
  if (/^\/(?:auth|sign-in)(?:\/|$)/.test(clean)) return '/auth';
  return 'unknown';
}

// SDK defaults change between majors. Opt out of every automatic data category.
export const privateDataCollection: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 0,
};

/** Only generated debug IDs/the fixed worker filename survive; no arbitrary stack strings. */
const debugIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

function codeFile(value: string | undefined, debugId?: string): string | undefined {
  if (!value) return;
  // Idempotent: the transport applies the same policy again after SDK processing.
  if (value === 'app:///dist/worker.mjs') return value;
  const canonicalId = value.match(/^app:\/\/\/next\/([^/]+)\.js$/)?.[1];
  if (canonicalId === 'unmapped' || (canonicalId && debugIdPattern.test(canonicalId))) return value;
  let path = value;
  try {
    if (value.includes('://')) path = new URL(value).pathname;
  } catch {
    return;
  }
  if (/^\/(?:app|[^?#]*echoandaura)\/dist\/worker\.mjs$/.test(path))
    return 'app:///dist/worker.mjs';
  if (!/\/(?:_next\/static|\.next-build\/server)\//.test(path)) return;
  if (!/\.m?js$/.test(path)) return;
  // Next 16's chunk names are not necessarily hexadecimal. Debug IDs link
  // frames to uploaded maps without copying any raw source or asset path.
  return `app:///next/${debugId && debugIdPattern.test(debugId) ? debugId : 'unmapped'}.js`;
}

function safeFrame(frame: StackFrame, ids: Map<string, string>): StackFrame | null {
  const original = frame.abs_path ?? frame.filename;
  const filename = codeFile(original, original ? ids.get(original) : undefined);
  if (!filename) return null;
  return {
    filename,
    abs_path: filename,
    ...(Number.isSafeInteger(frame.lineno) && (frame.lineno ?? 0) > 0
      ? { lineno: frame.lineno }
      : {}),
    ...(Number.isSafeInteger(frame.colno) && (frame.colno ?? 0) >= 0 ? { colno: frame.colno } : {}),
    in_app: true,
  };
}

/** Reconstruct, don't regex-scrub: arbitrary messages/SQL parameters can contain any trxID or name. */
export function privateErrorEvent(event: Event): ErrorEvent | null {
  if (event.type !== undefined || !event.exception?.values?.length) return null;
  const tags: NonNullable<Event['tags']> = {};
  for (const [key, allow] of [
    ['component', components],
    ['operation', operations],
    ['queue', queues],
    ['route', routes],
  ] as const) {
    const value = event.tags?.[key];
    if (typeof value === 'string' && allow.has(value)) tags[key] = value;
  }
  const ids = new Map<string, string>();
  for (const image of (event.debug_meta?.images ?? []).slice(0, 50)) {
    if (
      image.type === 'sourcemap' &&
      image.code_file &&
      image.debug_id &&
      debugIdPattern.test(image.debug_id)
    ) {
      ids.set(image.code_file, image.debug_id);
    }
  }
  const values = event.exception.values.slice(-5).map((exception) => ({
    type: types.has(exception.type ?? '') ? exception.type : 'Error',
    value: 'Unexpected application error (private details omitted)',
    mechanism: { type: 'generic', handled: exception.mechanism?.handled !== false },
    stacktrace: {
      frames: (exception.stacktrace?.frames ?? [])
        .slice(-50)
        .map((frame) => safeFrame(frame, ids))
        .filter((f): f is StackFrame => f !== null),
    },
  }));
  const images = (event.debug_meta?.images ?? []).slice(0, 50).flatMap((image) => {
    const file = codeFile(image.code_file, image.debug_id);
    return image.type === 'sourcemap' && file && debugIdPattern.test(image.debug_id ?? '')
      ? [{ type: 'sourcemap' as const, code_file: file, debug_id: image.debug_id }]
      : [];
  });
  return {
    type: undefined,
    // Protocol metadata for JavaScript stack processing, never a caller string.
    platform: event.platform === 'node' ? 'node' : 'javascript',
    ...(typeof event.event_id === 'string' && /^[a-f0-9]{32}$/.test(event.event_id)
      ? { event_id: event.event_id }
      : {}),
    ...(typeof event.release === 'string' && /^[a-f0-9]{40}$/.test(event.release)
      ? { release: event.release }
      : {}),
    environment: event.environment === 'staging' ? 'staging' : 'production',
    level: event.level === 'fatal' ? 'fatal' : 'error',
    exception: { values },
    tags,
    ...(images.length ? { debug_meta: { images } } : {}),
  };
}

/** Last outbound boundary: drop attachments, sessions, traces, logs, metrics and envelope trace context. */
export function privateEnvelope(envelope: Envelope): EventEnvelope | null {
  const items: EventEnvelope[1] = [];
  for (const [header, payload] of envelope[1]) {
    if (header.type !== 'event' || typeof payload !== 'object' || payload === null) continue;
    const event = privateErrorEvent(payload as Event);
    if (event?.event_id) items.push([{ type: 'event' }, event]);
  }
  if (!items.length) return null;
  return [
    { event_id: (items[0]?.[1] as Event).event_id ?? '', sent_at: new Date().toISOString() },
    items,
  ];
}

/** Telemetry failure must never become an application failure or a rejected promise. */
export function privateTransport(base: Transport): Transport {
  return {
    send(envelope) {
      try {
        const safe = privateEnvelope(envelope);
        return safe ? Promise.resolve(base.send(safe)).catch(() => ({})) : Promise.resolve({});
      } catch {
        return Promise.resolve({});
      }
    },
    flush(timeout) {
      try {
        return Promise.resolve(base.flush(timeout)).catch(() => false);
      } catch {
        return Promise.resolve(false);
      }
    },
  };
}

export function errorTrackingOptions(component: ErrorComponent, release: string | null) {
  return {
    // An empty value prevents the Node SDK falling back to a runtime SENTRY_RELEASE.
    // The outbound allowlist drops it, so only image-owned revisions can ship.
    release: release ?? '',
    environment: 'production',
    debug: false,
    spotlight: false,
    defaultIntegrations: false as const,
    dataCollection: privateDataCollection,
    tracesSampleRate: 0,
    tracePropagationTargets: [],
    enableLogs: false,
    maxBreadcrumbs: 0,
    sendClientReports: false,
    includeLocalVariables: false,
    beforeSend: privateErrorEvent,
    beforeBreadcrumb: () => null,
    beforeSendLog: () => null,
    beforeSendMetric: () => null,
    initialScope: { tags: { component } },
  };
}
