import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TurnstileVerifier } from '@/server/lib/turnstile';

const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
const verify = vi.hoisted(() => vi.fn<TurnstileVerifier['verify']>());
// Every config the verifier was built from. A plain array, not mock.calls:
// the singleton is built in whichever test runs first.
const built = vi.hoisted((): unknown[] => []);
const createTurnstileVerifier = vi.hoisted(() => (config: unknown) => {
  built.push(config);
  return { verify };
});
const requestIp = vi.hoisted(() => vi.fn(async () => '203.0.113.7'));

vi.mock('@/server/lib/logger', () => ({ logger: log }));
vi.mock('@/lib/request-ip', () => ({ requestIp }));
vi.mock('@/server/lib/turnstile', () => ({ createTurnstileVerifier }));

import { passesHumanCheck } from '@/lib/human-check';
import { TURNSTILE_TEST_SECRET_KEY } from '@/lib/turnstile-config';

const TOKEN = 'solved-token-abc';

function form(token?: string): FormData {
  const fd = new FormData();
  fd.set('phone', '01712345678');
  if (token !== undefined) fd.set('cf-turnstile-response', token);
  return fd;
}

beforeAll(() => {
  // The verifier is built from the environment on first use: pin it to a
  // local stack so a developer's .env can't change what is asserted.
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('TURNSTILE_SITE_KEY', '');
  vi.stubEnv('TURNSTILE_SECRET_KEY', '');
});

beforeEach(() => {
  log.info.mockClear();
  verify.mockReset();
});

describe('passesHumanCheck', () => {
  it("sends the form's token, this form's action and the caller's IP to the verifier", async () => {
    verify.mockResolvedValueOnce({ ok: true, degraded: false });
    expect(await passesHumanCheck(form(TOKEN), 'register')).toBe(true);
    expect(verify).toHaveBeenCalledWith(TOKEN, { action: 'register', ip: '203.0.113.7' });
  });

  it('builds the verifier once, from the Turnstile config', async () => {
    verify.mockResolvedValue({ ok: true, degraded: false });
    await passesHumanCheck(form(TOKEN), 'find-order');
    await passesHumanCheck(form(TOKEN), 'find-order');
    expect(built).toEqual([
      expect.objectContaining({ secretKey: TURNSTILE_TEST_SECRET_KEY, expectedHostname: null }),
    ]);
  });

  it('passes null through when the form has no token (the verifier refuses it)', async () => {
    verify.mockResolvedValueOnce({ ok: false, reason: 'missing' });
    expect(await passesHumanCheck(form(), 'buyer-sign-in')).toBe(false);
    expect(verify).toHaveBeenCalledWith(null, { action: 'buyer-sign-in', ip: '203.0.113.7' });
  });

  it('lets a degraded verdict through (Cloudflare could not be asked)', async () => {
    verify.mockResolvedValueOnce({ ok: true, degraded: true });
    expect(await passesHumanCheck(form(TOKEN), 'admin-login')).toBe(true);
    expect(log.info).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'action-mismatch', 'hostname-mismatch', 'misconfigured'] as const)(
    'returns false on %s and logs the reason, never the token',
    async (reason) => {
      verify.mockResolvedValueOnce({ ok: false, reason });
      expect(await passesHumanCheck(form(TOKEN), 'password-reset')).toBe(false);
      expect(log.info).toHaveBeenCalledWith(
        { action: 'password-reset', reason },
        'turnstile check refused',
      );
      expect(JSON.stringify(log.info.mock.calls)).not.toContain(TOKEN);
    },
  );
});
