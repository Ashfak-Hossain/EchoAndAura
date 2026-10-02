import { beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock('@/server/lib/logger', () => ({ logger: log }));

import { TURNSTILE_TOKEN_MAX } from '@/lib/turnstile-config';
import { createTurnstileVerifier, SITEVERIFY_URL } from '@/server/lib/turnstile';

const HOST = 'echoandaura.com';
const TOKEN = 'a-real-looking-token';
const ctx = { action: 'register' as const, ip: '203.0.113.7' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** What siteverify answers for a genuine token solved on our register form. */
const genuine = { success: true, hostname: HOST, action: 'register', 'error-codes': [] };

function setup(answer: () => Promise<Response>, expectedHostname: string | null = HOST) {
  const fetch = vi.fn<typeof globalThis.fetch>(answer);
  const verifier = createTurnstileVerifier({
    secretKey: '0x4AAAAAAA-real-secret',
    expectedHostname,
    fetch,
    timeoutMs: 20,
    idempotencyKey: () => 'idem-1',
  });
  return { fetch, verifier };
}

/** The form fields the verifier POSTed. */
function sentBody(fetch: ReturnType<typeof setup>['fetch']): URLSearchParams {
  const init = fetch.mock.calls[0]?.[1];
  if (!(init?.body instanceof URLSearchParams)) throw new Error('expected a form-encoded body');
  return init.body;
}

beforeEach(() => vi.clearAllMocks());

describe('createTurnstileVerifier — verdicts', () => {
  it('passes a genuine token solved on our host for this form', async () => {
    const { verifier } = setup(async () => json(genuine));
    expect(await verifier.verify(TOKEN, ctx)).toEqual({ ok: true, degraded: false });
  });

  it('rejects a token Cloudflare calls invalid', async () => {
    const { verifier } = setup(async () =>
      json({ success: false, 'error-codes': ['invalid-input-response'] }),
    );
    expect(await verifier.verify(TOKEN, ctx)).toEqual({ ok: false, reason: 'rejected' });
  });

  it('rejects a token already spent or expired (tokens are single-use)', async () => {
    const { verifier } = setup(async () =>
      json({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    );
    expect(await verifier.verify(TOKEN, ctx)).toEqual({ ok: false, reason: 'rejected' });
  });

  it('refuses a token solved on another form', async () => {
    const { verifier } = setup(async () => json({ ...genuine, action: 'find-order' }));
    expect(await verifier.verify(TOKEN, ctx)).toEqual({ ok: false, reason: 'action-mismatch' });
  });

  it('refuses a token solved on another host', async () => {
    const { verifier } = setup(async () => json({ ...genuine, hostname: 'evil.example.com' }));
    expect(await verifier.verify(TOKEN, ctx)).toEqual({ ok: false, reason: 'hostname-mismatch' });
  });

  it('refuses when the answer names no action or host at all', async () => {
    const { verifier } = setup(async () => json({ success: true }));
    expect(await verifier.verify(TOKEN, ctx)).toEqual({ ok: false, reason: 'action-mismatch' });
  });

  it('skips both claims on test keys (expectedHostname null)', async () => {
    // The test secret's answer carries example.com and no action.
    const { verifier } = setup(
      async () => json({ success: true, hostname: 'example.com', action: '' }),
      null,
    );
    expect(await verifier.verify(TOKEN, ctx)).toEqual({ ok: true, degraded: false });
  });

  it.each(['invalid-input-secret', 'missing-input-secret'])(
    'fails closed and logs an error when our secret is %s',
    async (code) => {
      const { verifier } = setup(async () => json({ success: false, 'error-codes': [code] }));
      expect(await verifier.verify(TOKEN, ctx)).toEqual({ ok: false, reason: 'misconfigured' });
      expect(log.error).toHaveBeenCalledTimes(1);
    },
  );
});

describe('createTurnstileVerifier — not a token', () => {
  it.each([
    ['missing', null],
    ['empty', ''],
    ['a File', new File(['x'], 'x.txt')],
    ['a number', 42],
    ['over the limit', 'x'.repeat(TURNSTILE_TOKEN_MAX + 1)],
  ])('refuses %s without calling Cloudflare', async (_label, token) => {
    const { fetch, verifier } = setup(async () => json(genuine));
    expect(await verifier.verify(token, ctx)).toEqual({ ok: false, reason: 'missing' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends a token exactly at the limit', async () => {
    const { fetch, verifier } = setup(async () => json(genuine));
    const token = 'x'.repeat(TURNSTILE_TOKEN_MAX);
    expect(await verifier.verify(token, ctx)).toEqual({ ok: true, degraded: false });
    expect(sentBody(fetch).get('response')).toBe(token);
  });
});

describe('createTurnstileVerifier — Cloudflare unavailable fails open', () => {
  const degraded = { ok: true, degraded: true };

  it('allows when fetch throws', async () => {
    const { verifier } = setup(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await verifier.verify(TOKEN, ctx)).toEqual(degraded);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('allows when siteverify does not answer within the timeout', async () => {
    // Never settles on its own; only the verifier's AbortSignal ends it.
    const hang = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const slow = createTurnstileVerifier({
      secretKey: 'secret',
      expectedHostname: HOST,
      fetch: hang,
      timeoutMs: 10,
    });
    expect(await slow.verify(TOKEN, ctx)).toEqual(degraded);
    expect(hang).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it.each([500, 503])('allows when siteverify answers %i', async (status) => {
    const { verifier } = setup(async () => json(genuine, status));
    expect(await verifier.verify(TOKEN, ctx)).toEqual(degraded);
  });

  it('allows when the body is not JSON', async () => {
    const { verifier } = setup(async () => new Response('<html>bad gateway</html>'));
    expect(await verifier.verify(TOKEN, ctx)).toEqual(degraded);
  });

  it('allows when the JSON is in an unknown shape', async () => {
    const { verifier } = setup(async () => json({ ok: 'maybe' }));
    expect(await verifier.verify(TOKEN, ctx)).toEqual(degraded);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('allows on Cloudflare internal-error', async () => {
    const { verifier } = setup(async () =>
      json({ success: false, 'error-codes': ['internal-error'] }),
    );
    expect(await verifier.verify(TOKEN, ctx)).toEqual(degraded);
  });
});

describe('createTurnstileVerifier — the request', () => {
  it('POSTs the secret, token and idempotency key, form-encoded, to siteverify', async () => {
    const { fetch, verifier } = setup(async () => json(genuine));
    await verifier.verify(TOKEN, ctx);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(SITEVERIFY_URL);
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(sentBody(fetch))).toEqual({
      secret: '0x4AAAAAAA-real-secret',
      response: TOKEN,
      idempotency_key: 'idem-1',
      remoteip: '203.0.113.7',
    });
  });

  it('sends an IPv6 address as remoteip', async () => {
    const { fetch, verifier } = setup(async () => json(genuine));
    await verifier.verify(TOKEN, { ...ctx, ip: '2001:db8::1' });
    expect(sentBody(fetch).get('remoteip')).toBe('2001:db8::1');
  });

  it.each([
    ['unknown', 'unknown'],
    ['null', null],
  ])('omits remoteip when the IP is %s', async (_label, ip) => {
    const { fetch, verifier } = setup(async () => json(genuine));
    await verifier.verify(TOKEN, { ...ctx, ip });
    expect(sentBody(fetch).has('remoteip')).toBe(false);
  });

  it('uses a fresh UUID idempotency key by default', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(genuine));
    const verifier = createTurnstileVerifier({ secretKey: 's', expectedHostname: HOST, fetch });
    await verifier.verify(TOKEN, ctx);
    await verifier.verify(TOKEN, ctx);
    const keys = fetch.mock.calls.map(([, init]) =>
      init?.body instanceof URLSearchParams ? init.body.get('idempotency_key') : null,
    );
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('never logs the token or the secret', async () => {
    const { verifier } = setup(async () =>
      json({ success: false, 'error-codes': ['invalid-input-secret'] }),
    );
    await verifier.verify(TOKEN, ctx);
    const { verifier: down } = setup(async () => {
      throw new Error('fetch failed');
    });
    await down.verify(TOKEN, ctx);
    const logged = JSON.stringify([log.error.mock.calls, log.warn.mock.calls]);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain('real-secret');
  });
});
