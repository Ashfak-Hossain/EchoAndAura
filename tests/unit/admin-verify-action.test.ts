import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError } from 'better-auth/api';

/**
 * ADR-049: the admin sign-in's code step. better-auth (its challenge
 * cookie, attempt counts, account lock) and the limiter are mocked; what
 * is under test is the action's parsing, order, and how each better-auth
 * answer is worded or routed.
 */
type Rule = { scope: string; subject: string; limit: number; windowSeconds: number };
const allow = vi.fn<(rules: Rule[]) => Promise<boolean>>();
const verifyTOTP = vi.fn();
const verifyBackupCode = vi.fn();
const logError = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock('@/lib/auth', () => ({ auth: { api: { verifyTOTP, verifyBackupCode } } }));
vi.mock('@/lib/request-ip', () => ({ requestIp: async () => '203.0.113.7' }));
vi.mock('@/server/lib/rate-limit', () => ({
  createRateLimiter: () => ({ allow, check: vi.fn() }),
  redisRateLimitStore: () => ({}),
}));
vi.mock('@/server/lib/logger', () => ({
  logger: { error: logError, warn: vi.fn(), info: vi.fn() },
}));

const { verifyCodeAction } = await import('@/app/admin/login/verify/actions');
const { expiredNotice } = await import('@/app/admin/login/expired-notice');

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/** The shape better-auth throws: APIError.from(status, { code, message }). */
function apiError(status: 'UNAUTHORIZED' | 'BAD_REQUEST' | 'TOO_MANY_REQUESTS', code: string) {
  return new APIError(status, { code, message: code });
}

const WRONG = 'That code is not right. Check the app and try again.';

beforeEach(() => {
  vi.unstubAllEnvs();
  // The unit run is not the e2e build; the limiter is on.
  vi.stubEnv('APP_ENV', 'development');
  allow.mockReset().mockResolvedValue(true);
  verifyTOTP.mockReset().mockResolvedValue({ token: 't', user: {} });
  verifyBackupCode.mockReset().mockResolvedValue({ token: 't', user: {} });
  logError.mockReset();
});

describe('admin sign-in code step — input', () => {
  it('a valid app code (spaces dropped) is sent to verifyTOTP; success opens the console', async () => {
    await expect(verifyCodeAction({}, form({ code: '123 456' }))).rejects.toThrow(
      /^redirect \/admin$/,
    );
    expect(verifyTOTP).toHaveBeenCalledWith({
      body: { code: '123456' },
      headers: expect.any(Headers),
    });
    expect(verifyBackupCode).not.toHaveBeenCalled();
  });

  it('a backup code (trimmed) goes to verifyBackupCode instead', async () => {
    await expect(verifyCodeAction({}, form({ backupCode: ' Ab3dE-9fGh2 ' }))).rejects.toThrow(
      /^redirect \/admin$/,
    );
    expect(verifyBackupCode).toHaveBeenCalledWith({
      body: { code: 'Ab3dE-9fGh2' },
      headers: expect.any(Headers),
    });
    expect(verifyTOTP).not.toHaveBeenCalled();
  });

  it('a malformed app code is answered without the limiter or better-auth', async () => {
    const state = await verifyCodeAction({}, form({ code: '12345' }));
    expect(state).toEqual({ error: 'The code is 6 digits', mode: 'totp' });
    expect(allow).not.toHaveBeenCalled();
    expect(verifyTOTP).not.toHaveBeenCalled();
  });

  it('a malformed backup code keeps the backup input', async () => {
    const state = await verifyCodeAction({}, form({ backupCode: 'not-a-code' }));
    expect(state).toEqual({ error: 'A backup code looks like Ab3dE-9fGh2', mode: 'backup' });
    expect(verifyBackupCode).not.toHaveBeenCalled();
  });

  it('no field at all is a validation error, not a call', async () => {
    const state = await verifyCodeAction({}, form({}));
    expect(state.error).toBe('Enter the 6-digit code from your authenticator app');
    expect(verifyTOTP).not.toHaveBeenCalled();
  });
});

describe('admin sign-in code step — throttle', () => {
  it('counts each attempt per IP', async () => {
    await expect(verifyCodeAction({}, form({ code: '123456' }))).rejects.toThrow();
    expect(allow).toHaveBeenCalledWith([
      { scope: 'admin-2fa:ip', subject: '203.0.113.7', limit: 10, windowSeconds: 60 },
    ]);
  });

  it('a spent IP budget refuses without asking better-auth', async () => {
    allow.mockResolvedValue(false);
    const state = await verifyCodeAction({}, form({ code: '123456' }));
    expect(state).toEqual({
      error: 'Too many attempts. Please wait a minute and try again.',
      mode: 'totp',
    });
    expect(verifyTOTP).not.toHaveBeenCalled();
  });

  it('is off for the e2e suite (APP_ENV=test)', async () => {
    vi.stubEnv('APP_ENV', 'test');
    allow.mockResolvedValue(false);
    await expect(verifyCodeAction({}, form({ code: '123456' }))).rejects.toThrow(
      /^redirect \/admin$/,
    );
    expect(allow).not.toHaveBeenCalled();
  });
});

describe('admin sign-in code step — better-auth answers', () => {
  it('a wrong app code says so and keeps the app input', async () => {
    verifyTOTP.mockRejectedValue(apiError('UNAUTHORIZED', 'INVALID_CODE'));
    expect(await verifyCodeAction({}, form({ code: '000000' }))).toEqual({
      error: WRONG,
      mode: 'totp',
    });
  });

  it('a wrong backup code gets the same answer', async () => {
    verifyBackupCode.mockRejectedValue(apiError('UNAUTHORIZED', 'INVALID_BACKUP_CODE'));
    expect(await verifyCodeAction({}, form({ backupCode: 'Ab3dE-9fGh2' }))).toEqual({
      error: WRONG,
      mode: 'backup',
    });
  });

  it('a challenge out of tries sends back to the password step, saying so (not "timed out")', async () => {
    verifyTOTP.mockRejectedValue(apiError('BAD_REQUEST', 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE'));
    await expect(verifyCodeAction({}, form({ code: '000000' }))).rejects.toThrow(
      /^redirect \/admin\/login\?expired=attempts$/,
    );
    expect(expiredNotice('attempts')).toBe(
      'Too many wrong codes for this sign-in. Enter your password again.',
    );
  });

  it('an expired or already-used challenge sends back to the password step', async () => {
    verifyBackupCode.mockRejectedValue(apiError('UNAUTHORIZED', 'INVALID_TWO_FACTOR_COOKIE'));
    await expect(verifyCodeAction({}, form({ backupCode: 'Ab3dE-9fGh2' }))).rejects.toThrow(
      'redirect /admin/login?expired=1',
    );
  });

  it('a locked account says for how long', async () => {
    verifyTOTP.mockRejectedValue(apiError('TOO_MANY_REQUESTS', 'ACCOUNT_TEMPORARILY_LOCKED'));
    expect(await verifyCodeAction({}, form({ code: '000000' }))).toEqual({
      error: 'Too many wrong codes. Two-factor sign-in is locked for 15 minutes.',
      mode: 'totp',
    });
  });

  it('an infrastructure failure is not disguised as a wrong code, and the code is never logged', async () => {
    verifyTOTP.mockRejectedValue(new Error('db down'));
    const state = await verifyCodeAction({}, form({ code: '424242' }));
    expect(state).toEqual({
      error: 'Sign-in is temporarily unavailable. Please try again.',
      mode: 'totp',
    });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logError.mock.calls)).not.toContain('424242');
  });

  it('two-factor reset (admin:reset-2fa) while the challenge was open: back to the password, no error log', async () => {
    verifyTOTP.mockRejectedValue(apiError('BAD_REQUEST', 'TOTP_NOT_ENABLED'));
    await expect(verifyCodeAction({}, form({ code: '000000' }))).rejects.toThrow(
      /^redirect \/admin\/login\?expired=1$/,
    );
    verifyBackupCode.mockRejectedValue(apiError('BAD_REQUEST', 'BACKUP_CODES_NOT_ENABLED'));
    await expect(verifyCodeAction({}, form({ backupCode: 'Ab3dE-9fGh2' }))).rejects.toThrow(
      /^redirect \/admin\/login\?expired=1$/,
    );
    expect(logError).not.toHaveBeenCalled();
  });

  it('an unexpected better-auth error is the outage answer too', async () => {
    verifyTOTP.mockRejectedValue(
      apiError('BAD_REQUEST', 'FAILED_TO_INVALIDATE_TWO_FACTOR_CHALLENGE'),
    );
    const state = await verifyCodeAction({}, form({ code: '000000' }));
    expect(state.error).toBe('Sign-in is temporarily unavailable. Please try again.');
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

describe('admin sign-in — why the code step sent the admin back', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['1', 'Your sign-in timed out. Enter your password again.'],
    ['attempts', 'Too many wrong codes for this sign-in. Enter your password again.'],
    // Anything else in the URL is a timeout, never echoed back.
    ['<b>x</b>', 'Your sign-in timed out. Enter your password again.'],
  ])('?expired=%s → %s', (param, notice) => {
    expect(expiredNotice(param)).toBe(notice);
  });
});
