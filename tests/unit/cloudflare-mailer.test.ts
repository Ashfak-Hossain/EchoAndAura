import { describe, expect, it, vi } from 'vitest';
import { MailerPermanentError, MailerThrottledError } from '@/server/email/mailer';
import {
  type Fetch,
  createCloudflareMailer,
  parseAddress,
  readCloudflareEmailEnv,
} from '@/server/email/cloudflare-mailer';

const env = { from: 'echoandaura <tickets@echoandaura.com>', replyTo: 'hello@echoandaura.com' };
const cf = { accountId: '0123456789abcdef0123456789abcdef', apiToken: 'x'.repeat(40) };
const message = {
  to: 'nusrat@example.com',
  subject: 'Your 2 tickets',
  html: '<p>Hello</p>',
  text: 'Hello',
  attachments: [
    {
      filename: 'tickets-EA-1.pdf',
      content: Buffer.from('%PDF-1.4 fake'),
      contentType: 'application/pdf',
    },
  ],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A fake API answering `status` with `body`; records every call. */
function api(status: number, body: unknown) {
  return vi.fn<Fetch>(async () => new Response(JSON.stringify(body), { status }));
}
const ok = (result: Record<string, string[]>) => ({
  success: true,
  errors: [],
  messages: [],
  result: { delivered: [], permanent_bounces: [], queued: [], ...result },
});
const failed = (code: number, text: string) => ({
  success: false,
  errors: [{ code, message: text }],
  messages: [],
  result: null,
});

describe('cloudflare mailer', () => {
  it('posts the documented JSON: named from, reply_to, both bodies, the PDF in base64, our id', async () => {
    const fetch = api(200, ok({ delivered: ['nusrat@example.com'] }));
    const out = await createCloudflareMailer(env, cf, fetch).send(message);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/email/sending/send',
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: `Bearer ${cf.apiToken}`,
      'Content-Type': 'application/json',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      from: { address: 'tickets@echoandaura.com', name: 'echoandaura' },
      to: 'nusrat@example.com',
      reply_to: 'hello@echoandaura.com',
      subject: 'Your 2 tickets',
      html: '<p>Hello</p>',
      text: 'Hello',
      attachments: [
        {
          content: Buffer.from('%PDF-1.4 fake').toString('base64'),
          filename: 'tickets-EA-1.pdf',
          type: 'application/pdf',
          disposition: 'attachment',
        },
      ],
    });
    // The id we return is the one stamped on the email.
    expect(out.messageId).toMatch(UUID);
    expect(body.headers).toEqual({ 'X-Echoandaura-Id': out.messageId });
  });

  it('leaves out reply_to and attachments when there are none', async () => {
    const fetch = api(200, ok({ delivered: ['nusrat@example.com'] }));
    await createCloudflareMailer({ ...env, replyTo: null }, cf, fetch).send({
      ...message,
      attachments: undefined,
    });
    const body = JSON.parse(String(fetch.mock.calls[0]![1].body));
    expect(body).not.toHaveProperty('reply_to');
    expect(body).not.toHaveProperty('attachments');
  });

  it('records a queued delivery as sent', async () => {
    const out = await createCloudflareMailer(
      env,
      cf,
      api(200, ok({ queued: ['nusrat@example.com'] })),
    ).send(message);
    expect(out.messageId).toMatch(/ \(queued\)$/);
  });

  it('a permanent bounce is never retried', async () => {
    const mailer = createCloudflareMailer(
      env,
      cf,
      api(200, ok({ permanent_bounces: ['nusrat@example.com'] })),
    );
    await expect(mailer.send(message)).rejects.toThrow(MailerPermanentError);
  });

  it('a rate limit is retried with backoff', async () => {
    const mailer = createCloudflareMailer(
      env,
      cf,
      api(429, failed(10004, 'email.sending.error.throttled')),
    );
    await expect(mailer.send(message)).rejects.toThrow(MailerThrottledError);
  });

  it('a request the API will never accept is not retried', async () => {
    for (const [code, text] of [
      [10001, 'email.sending.error.invalid_request_schema'],
      [10200, 'email.sending.error.email.too_big'],
      [10202, 'email.sending.error.email.invalid'],
    ] as const) {
      const mailer = createCloudflareMailer(env, cf, api(400, failed(code, text)));
      await expect(mailer.send(message)).rejects.toThrow(MailerPermanentError);
    }
  });

  it('token, permission and server problems stay retryable, so the email goes once fixed', async () => {
    for (const [status, code] of [
      [401, 10101],
      [403, 10102],
      [403, 10203],
      [500, 10002],
      [503, 10100],
    ] as const) {
      const mailer = createCloudflareMailer(env, cf, api(status, failed(code, 'x')));
      const err = await mailer.send(message).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(MailerPermanentError);
      expect(err).not.toBeInstanceOf(MailerThrottledError);
      expect((err as Error).message).toContain(String(code));
    }
  });

  it('a non-JSON error page and a network failure are retryable', async () => {
    const html = vi.fn<Fetch>(
      async () => new Response('<html>Bad gateway</html>', { status: 502 }),
    );
    await expect(createCloudflareMailer(env, cf, html).send(message)).rejects.toThrow(/502/);

    const down = vi.fn<Fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(createCloudflareMailer(env, cf, down).send(message)).rejects.toThrow(
      'fetch failed',
    );
  });
});

describe('parseAddress', () => {
  it('splits a display name from the address, and keeps a bare address', () => {
    expect(parseAddress('echoandaura <tickets@echoandaura.com>')).toEqual({
      address: 'tickets@echoandaura.com',
      name: 'echoandaura',
    });
    expect(parseAddress('"Echo & Aura" <tickets@echoandaura.com>')).toEqual({
      address: 'tickets@echoandaura.com',
      name: 'Echo & Aura',
    });
    expect(parseAddress('<tickets@echoandaura.com>')).toBe('tickets@echoandaura.com');
    expect(parseAddress(' tickets@echoandaura.com ')).toBe('tickets@echoandaura.com');
  });
});

describe('readCloudflareEmailEnv', () => {
  const vars = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

  it('reads both values', () => {
    expect(
      readCloudflareEmailEnv(
        vars({ CLOUDFLARE_ACCOUNT_ID: cf.accountId, CLOUDFLARE_EMAIL_API_TOKEN: cf.apiToken }),
      ),
    ).toEqual(cf);
  });

  it('refuses a missing value or a placeholder, without printing it', () => {
    expect(() => readCloudflareEmailEnv(vars({}))).toThrow(/not set/);
    expect(() =>
      readCloudflareEmailEnv(
        vars({ CLOUDFLARE_ACCOUNT_ID: 'your-account-id', CLOUDFLARE_EMAIL_API_TOKEN: cf.apiToken }),
      ),
    ).toThrow(/does not look like an account id/);
    const placeholder = 'changeme';
    const err = (() => {
      try {
        readCloudflareEmailEnv(
          vars({ CLOUDFLARE_ACCOUNT_ID: cf.accountId, CLOUDFLARE_EMAIL_API_TOKEN: placeholder }),
        );
      } catch (e: unknown) {
        return e as Error;
      }
      return null;
    })();
    expect(err?.message).toMatch(/does not look like an API token/);
    expect(err?.message).not.toContain(placeholder);
  });
});
