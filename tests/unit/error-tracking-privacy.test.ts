import { describe, expect, it, vi } from 'vitest';
import { NodeClient, defaultStackParser } from '@sentry/node';
import { serializeEnvelope, type Envelope, type Event, type Transport } from '@sentry/core';
import {
  errorRoute,
  errorTrackingOptions,
  privateEnvelope,
  privateErrorEvent,
  privateTransport,
  sentryDsn,
} from '@/lib/error-tracking/privacy';
import { buildCsp } from '@/lib/csp';

const id = 'a'.repeat(32);
const revision = 'b'.repeat(40);
const debugId = '12345678-1234-1234-1234-123456789abc';
const dsn = `https://${id}@o123.ingest.us.sentry.io/123`;
const privateValues = [
  'Buyer Alice',
  'buyer@example.com',
  '01712345678',
  'AB12CD34E5',
  'magic-secret',
  'pass-secret',
  'Bearer private-auth',
];
const secret = privateValues.join(' ');
const asset = 'https://echoandaura.com/_next/static/chunks/3n3-t71sg89d-.js';

function event(): Event {
  return {
    event_id: id,
    release: revision,
    environment: 'production',
    message: secret,
    logentry: { message: secret, params: [secret] },
    user: { email: privateValues[1], username: privateValues[0], ip_address: '203.0.113.1' },
    request: {
      url: `https://echoandaura.com/tickets/pass-secret?token=magic-secret`,
      headers: { Authorization: secret },
      cookies: { pass: secret },
      data: secret,
    },
    extra: { sql: secret, nested: { causes: [secret] }, job: { data: secret } },
    breadcrumbs: [{ message: secret, data: { url: secret } }],
    contexts: {
      runtime: { name: secret },
      trace: { trace_id: id, span_id: id.slice(0, 16), data: { query: secret } },
    },
    tags: {
      component: 'web',
      operation: 'payment.submit',
      route: '/orders/[id]',
      buyer: secret,
      queue: secret,
    },
    exception: {
      values: [
        {
          type: 'PostgresError',
          value: secret,
          mechanism: { type: secret, handled: true, data: { private: secret } },
          stacktrace: {
            frames: [
              {
                filename: asset,
                function: secret,
                lineno: 12,
                colno: 4,
                vars: { buyer: secret },
                context_line: secret,
                pre_context: [secret],
                post_context: [secret],
              },
              { filename: secret, lineno: 1 },
            ],
          },
        },
      ],
    },
    debug_meta: { images: [{ type: 'sourcemap', code_file: asset, debug_id: debugId }] },
    server_name: secret,
    modules: { [secret]: secret },
    fingerprint: [secret],
  };
}

function envelope(payload = event()): Envelope {
  return [
    {
      event_id: id,
      sent_at: new Date().toISOString(),
      trace: { trace_id: id, transaction: secret },
      sdk: { name: secret },
    },
    [
      [{ type: 'event', private: secret }, payload],
      [{ type: 'attachment', length: secret.length, filename: secret }, secret],
    ],
  ];
}

describe('outbound privacy policy', () => {
  it('reconstructs a serialized envelope without any buyer, credential, SQL, job or request data', () => {
    const safe = privateEnvelope(envelope());
    expect(safe).not.toBeNull();
    const wire = serializeEnvelope(safe!);
    expect(typeof wire).toBe('string');
    for (const value of privateValues) expect(wire).not.toContain(value);
    expect(wire).not.toContain('203.0.113.1');
    expect(wire).not.toContain('echoandaura.com');
    expect(wire).not.toContain('attachment');
    const payload = safe?.[1][0]?.[1] as Event;
    expect(payload.release).toBe(revision);
    expect(payload.platform).toBe('javascript');
    expect(payload.tags).toEqual({
      component: 'web',
      operation: 'payment.submit',
      route: '/orders/[id]',
    });
    expect(payload.exception?.values?.[0]?.stacktrace?.frames).toEqual([
      {
        filename: `app:///next/${debugId}.js`,
        abs_path: `app:///next/${debugId}.js`,
        lineno: 12,
        colno: 4,
        in_app: true,
      },
    ]);
    expect(payload.debug_meta?.images).toEqual([
      { type: 'sourcemap', code_file: `app:///next/${debugId}.js`, debug_id: debugId },
    ]);
  });

  it('is idempotent and preserves Next non-hex chunk / worker frames without raw filenames', () => {
    const safe = privateErrorEvent(event());
    expect(privateErrorEvent(safe!)).toEqual(safe);
    expect(privateErrorEvent({ ...event(), platform: 'node' })?.platform).toBe('node');
    expect(privateErrorEvent({ ...event(), platform: secret })?.platform).toBe('javascript');
    const payload = event();
    payload.exception!.values![0]!.stacktrace!.frames = [
      { filename: '/app/dist/worker.mjs', lineno: 5, colno: 10 },
    ];
    expect(
      privateErrorEvent(payload)?.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename,
    ).toBe('app:///dist/worker.mjs');
    payload.debug_meta = undefined;
    payload.exception!.values![0]!.stacktrace!.frames = [{ filename: asset, lineno: 5 }];
    expect(
      privateErrorEvent(payload)?.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename,
    ).toBe('app:///next/unmapped.js');
  });

  it('drops non-error envelopes, unknown exception types, poisoned canonical filenames and invalid debug IDs', () => {
    expect(
      privateEnvelope([
        { sent_at: '' },
        [
          [
            { type: 'session' },
            { sid: id, init: true, started: '', timestamp: '', status: 'ok', errors: 0, attrs: {} },
          ],
        ],
      ]),
    ).toBeNull();
    expect(privateErrorEvent({ ...event(), type: 'transaction' })).toBeNull();
    expect(privateErrorEvent({ message: secret })).toBeNull();
    const payload = event();
    payload.exception!.values![0]!.type = secret;
    payload.exception!.values![0]!.stacktrace!.frames = [
      { filename: 'app:///next/01712345678.js' },
    ];
    payload.debug_meta = {
      images: [{ type: 'sourcemap', code_file: asset, debug_id: privateValues[3] }],
    };
    const safe = privateErrorEvent(payload);
    expect(safe?.exception?.values?.[0]?.type).toBe('Error');
    expect(safe?.exception?.values?.[0]?.stacktrace?.frames).toEqual([]);
    expect(safe?.debug_meta).toBeUndefined();
  });

  it('handles synchronous throws and asynchronous vendor failures without failing the caller', async () => {
    const base: Transport = {
      send: vi.fn(() => {
        throw new Error(secret);
      }),
      flush: vi.fn(() => Promise.reject(new Error(secret))),
    };
    const transport = privateTransport(base);
    await expect(transport.send(envelope())).resolves.toEqual({});
    await expect(transport.flush(10)).resolves.toBe(false);
    const failed = privateTransport({ ...base, send: () => Promise.reject(new Error(secret)) });
    await expect(failed.send(envelope())).resolves.toEqual({});
  });

  it('applies the policy in the actual SDK event pipeline, after scope/context processors', async () => {
    const outgoing: Envelope[] = [];
    const client = new NodeClient({
      ...errorTrackingOptions('worker', revision),
      dsn,
      stackParser: defaultStackParser,
      integrations: [],
      transport: () =>
        privateTransport({
          send: async (e) => {
            outgoing.push(e);
            return { statusCode: 200 };
          },
          flush: async () => true,
        }),
    });
    client.addEventProcessor((e) => ({
      ...e,
      user: { email: privateValues[1] },
      extra: { payload: secret },
    }));
    const error = new Error(secret);
    error.stack = `Error: ${secret}\n    at sendTicket (/app/dist/worker.mjs:42:10)`;
    client.captureException(error);
    await client.flush(1000);
    expect(outgoing).toHaveLength(1);
    const wire = serializeEnvelope(outgoing[0]!);
    for (const value of privateValues) expect(wire).not.toContain(value);
    const captured = outgoing[0]![1][0]?.[1] as Event;
    expect(captured.release).toBe(revision);
    expect(captured.exception?.values?.[0]?.stacktrace?.frames?.[0]?.lineno).toBe(42);
    await client.close(1000);
  });
});

describe('configuration and static routes', () => {
  it('disables auxiliary debug/sidecar channels and prevents runtime release fallback', () => {
    const options = errorTrackingOptions('worker', null);
    expect(options).toMatchObject({ release: '', debug: false, spotlight: false });
    expect(privateErrorEvent({ ...event(), release: options.release })?.release).toBeUndefined();
  });
  it.each([
    undefined,
    '',
    'no url',
    dsn.replace('https:', 'http:'),
    `${dsn}?buyer=private`,
    `${dsn}#token`,
    dsn.replace('sentry.io', 'sentry.io.evil.example'),
    dsn.replace('@', ':secret@'),
    'https://example.com/123',
  ])('rejects invalid/unsafe DSN %s', (value) => {
    expect(sentryDsn(value)).toBeNull();
  });
  it('adds only the exact ingest connect origin, with the existing script policy unchanged', () => {
    expect(sentryDsn(dsn)).toEqual({ dsn, origin: 'https://o123.ingest.us.sentry.io' });
    const base = { nonce: 'abc', mediaOrigin: null, uploadOrigin: null, door: true, dev: false };
    const plain = buildCsp(base);
    expect(buildCsp({ ...base, errorOrigin: sentryDsn(dsn)?.origin })).toBe(
      plain.replace("connect-src 'self'", "connect-src 'self' https://o123.ingest.us.sentry.io"),
    );
  });
  it.each([
    ['/bn/orders/pass-secret?token=magic-secret', '/orders/[id]'],
    ['/events/Buyer Alice', '/events/[slug]'],
    ['/admin/orders/AB12CD34E5', '/admin/orders/[id]'],
    ['/tickets/pass-secret#magic-secret', '/tickets/[code]'],
    ['/door?pass=pass-secret', '/door'],
    ['/unknown/buyer@example.com', 'unknown'],
  ])('maps %s to %s', (path, route) => expect(errorRoute(path)).toBe(route));
});
