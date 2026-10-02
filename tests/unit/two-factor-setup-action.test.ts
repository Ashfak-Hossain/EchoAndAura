import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError } from 'better-auth/api';

/**
 * ADR-049: setting up two-factor (password → first app code) and making
 * new backup codes. better-auth, the session guards and the limiter are
 * mocked; what is under test is each action's wiring, its refusals, and
 * that the secret and the codes reach the page but never the log.
 */
type Rule = { scope: string; subject: string; limit: number; windowSeconds: number };
type Session = { email: string; name: string; role: 'admin' | 'buyer'; twoFactorEnabled: boolean };

const enableTwoFactor = vi.fn();
const verifyTOTP = vi.fn();
const generateBackupCodes = vi.fn();
const requireAdminPendingTwoFactor = vi.fn<() => Promise<Session>>();
const requireAdmin = vi.fn<() => Promise<Session>>();
const allow = vi.fn<(rules: Rule[]) => Promise<boolean>>();
const revokeSessionsCreatedBefore = vi.fn<(userId: string, before: Date) => Promise<number>>();
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock('@/lib/auth', () => ({
  auth: { api: { enableTwoFactor, verifyTOTP, generateBackupCodes } },
}));
vi.mock('@/lib/session', () => ({ requireAdmin, requireAdminPendingTwoFactor }));
vi.mock('@/lib/request-ip', () => ({ requestIp: async () => '203.0.113.7' }));
vi.mock('@/server/lib/rate-limit', () => ({
  createRateLimiter: () => ({ allow, check: allow }),
  redisRateLimitStore: () => ({}),
}));
vi.mock('@/server/lib/logger', () => ({ logger: log }));
vi.mock('@/server/repositories/admin-accounts.repository', () => ({
  adminAccountsRepository: { revokeSessionsCreatedBefore },
}));
// The account module's other actions send email; nothing here reaches them.
vi.mock('@/server/auth/account-emails', () => ({ takeExposedAccountLink: () => null }));
vi.mock('@/server/queue/producer', () => ({ enqueueAccountEmail: vi.fn() }));

const { startSetupAction, confirmSetupAction } =
  await import('@/app/admin/two-factor/setup/actions');
const { regenerateBackupCodesAction } = await import('@/app/admin/(protected)/account/actions');

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const TOTP_URI = `otpauth://totp/echoandaura:raj%40example.com?secret=${SECRET}&issuer=echoandaura&digits=6&period=30`;
const CODES = Array.from({ length: 10 }, (_, i) => `Ab3dE-9fGh${i}`);
const ADMIN: Session = {
  email: 'raj@example.com',
  name: 'Raj',
  role: 'admin',
  twoFactorEnabled: false,
};

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

function apiError(code: string): APIError {
  return new APIError('BAD_REQUEST', { code, message: code });
}

/** Everything the log was given, as one string to search. */
function logged(): string {
  return JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
}

beforeEach(() => {
  vi.unstubAllEnvs();
  // The unit run is not the e2e build; the limiter is on.
  vi.stubEnv('APP_ENV', 'development');
  enableTwoFactor.mockReset().mockResolvedValue({
    method: 'totp',
    totpURI: TOTP_URI,
    backupCodes: CODES,
  });
  verifyTOTP.mockReset().mockResolvedValue({ token: 't', user: { id: 'user-raj' } });
  revokeSessionsCreatedBefore.mockReset().mockResolvedValue(2);
  generateBackupCodes.mockReset().mockResolvedValue({ status: true, backupCodes: CODES });
  requireAdminPendingTwoFactor.mockReset().mockResolvedValue(ADMIN);
  requireAdmin.mockReset().mockResolvedValue({ ...ADMIN, twoFactorEnabled: true });
  allow.mockReset().mockResolvedValue(true);
  for (const fn of Object.values(log)) fn.mockReset();
});

describe('two-factor setup — step 1, the password', () => {
  it('returns the QR, the key and the codes; the log sees none of them', async () => {
    const state = await startSetupAction({}, form({ password: 'correct horse battery' }));
    expect(enableTwoFactor).toHaveBeenCalledWith({
      body: { password: 'correct horse battery' },
      headers: expect.any(Headers),
    });
    expect(state.error).toBeUndefined();
    expect(state.setup?.secret).toBe(SECRET);
    expect(state.setup?.backupCodes).toEqual(CODES);
    expect(state.setup?.qr).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(state.setup!.qr.split(',')[1]!, 'base64').toString();
    expect(svg).toContain('<svg');
    // Only the image and the key: the raw otpauth URI is not sent as such.
    expect(JSON.stringify(state)).not.toContain('otpauth://');

    expect(log.info).toHaveBeenCalled();
    expect(logged()).not.toContain(SECRET);
    for (const code of CODES) expect(logged()).not.toContain(code);
    expect(logged()).not.toContain('correct horse battery');
  });

  it('a wrong password is a field error', async () => {
    enableTwoFactor.mockRejectedValue(apiError('INVALID_PASSWORD'));
    const state = await startSetupAction({}, form({ password: 'wrong guess' }));
    expect(state).toEqual({ error: 'That password is not right', field: 'password' });
  });

  it('an empty password never reaches better-auth', async () => {
    const state = await startSetupAction({}, form({ password: '' }));
    expect(state).toEqual({ error: 'Enter your current password', field: 'password' });
    expect(allow).not.toHaveBeenCalled();
    expect(enableTwoFactor).not.toHaveBeenCalled();
  });

  it('already turned on (another tab finished first) → the console', async () => {
    enableTwoFactor.mockRejectedValue(apiError('TOTP_ALREADY_ENABLED'));
    await expect(startSetupAction({}, form({ password: 'pw-pw-pw-pw' }))).rejects.toThrow(
      'redirect /admin',
    );
  });

  it('an admin whose session already says it is on goes to the console without a call', async () => {
    requireAdminPendingTwoFactor.mockResolvedValue({ ...ADMIN, twoFactorEnabled: true });
    await expect(startSetupAction({}, form({ password: 'pw-pw-pw-pw' }))).rejects.toThrow(
      'redirect /admin',
    );
    expect(enableTwoFactor).not.toHaveBeenCalled();
  });

  it('an infrastructure failure is not a wrong password, and is logged without the password', async () => {
    enableTwoFactor.mockRejectedValue(new Error('db down'));
    const state = await startSetupAction({}, form({ password: 'correct horse battery' }));
    expect(state.field).toBeUndefined();
    expect(state.error).toMatch(/not available just now/);
    expect(log.error).toHaveBeenCalled();
    expect(logged()).not.toContain('correct horse battery');
  });

  it('a spent IP budget refuses without asking better-auth', async () => {
    allow.mockResolvedValue(false);
    const state = await startSetupAction({}, form({ password: 'pw-pw-pw-pw' }));
    expect(state).toEqual({ error: 'Too many attempts. Please wait a minute and try again.' });
    expect(allow).toHaveBeenCalledWith([
      { scope: 'admin-2fa-setup:ip', subject: '203.0.113.7', limit: 10, windowSeconds: 60 },
    ]);
    expect(enableTwoFactor).not.toHaveBeenCalled();
  });

  it('the limiter is off for the e2e suite (APP_ENV=test)', async () => {
    vi.stubEnv('APP_ENV', 'test');
    allow.mockResolvedValue(false);
    const state = await startSetupAction({}, form({ password: 'pw-pw-pw-pw' }));
    expect(state.setup).toBeDefined();
    expect(allow).not.toHaveBeenCalled();
  });
});

describe('two-factor setup — step 2, the first code', () => {
  it('a right code turns it on (sessionful verifyTOTP; spaces dropped)', async () => {
    const state = await confirmSetupAction({}, form({ code: '123 456' }));
    expect(state).toEqual({ done: true });
    expect(verifyTOTP).toHaveBeenCalledWith({
      body: { code: '123456' },
      headers: expect.any(Headers),
    });
  });

  it('a right code ends every older session of the admin (they never gave a code)', async () => {
    let calledAt = 0;
    verifyTOTP.mockImplementation(async () => {
      calledAt = Date.now();
      return { token: 't', user: { id: 'user-raj' } };
    });
    const state = await confirmSetupAction({}, form({ code: '123456' }));
    expect(state).toEqual({ done: true });
    expect(revokeSessionsCreatedBefore).toHaveBeenCalledTimes(1);
    const [userId, before] = revokeSessionsCreatedBefore.mock.calls[0]!;
    expect(userId).toBe('user-raj');
    // Taken before verifyTOTP, so the session it creates is not older.
    expect(before.getTime()).toBeLessThanOrEqual(calledAt);
  });

  it('a wrong code revokes nothing', async () => {
    verifyTOTP.mockRejectedValue(apiError('INVALID_CODE'));
    await confirmSetupAction({}, form({ code: '000000' }));
    expect(revokeSessionsCreatedBefore).not.toHaveBeenCalled();
  });

  it('a failed revoke still shows the codes (two-factor is on), and is logged as an error', async () => {
    revokeSessionsCreatedBefore.mockRejectedValue(new Error('db down'));
    const state = await confirmSetupAction({}, form({ code: '123456' }));
    expect(state).toEqual({ done: true });
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'db down' }),
      'two-factor on, but older sessions were not revoked',
    );
  });

  it('a wrong code points at this QR (step 1 again replaces the secret) and the phone clock', async () => {
    verifyTOTP.mockRejectedValue(
      new APIError('UNAUTHORIZED', { code: 'INVALID_CODE', message: 'Invalid code' }),
    );
    const state = await confirmSetupAction({}, form({ code: '000000' }));
    expect(state).toEqual({
      error:
        'That code is not right. Use the code for the QR on this page (delete any older echoandaura entry in the app), and check the time on your phone.',
    });
  });

  it('a factor that no longer exists asks to start again', async () => {
    verifyTOTP.mockRejectedValue(apiError('TOTP_NOT_ENABLED'));
    const state = await confirmSetupAction({}, form({ code: '123456' }));
    expect(state.restart).toBe(true);
    expect(state.error).toMatch(/Start again/);
  });

  it('not six digits never reaches better-auth', async () => {
    const state = await confirmSetupAction({}, form({ code: '12345' }));
    expect(state).toEqual({ error: 'The code is 6 digits' });
    expect(verifyTOTP).not.toHaveBeenCalled();
  });

  it('a spent IP budget refuses without asking better-auth', async () => {
    allow.mockResolvedValue(false);
    const state = await confirmSetupAction({}, form({ code: '123456' }));
    expect(state).toEqual({ error: 'Too many attempts. Please wait a minute and try again.' });
    expect(verifyTOTP).not.toHaveBeenCalled();
  });
});

describe('two-factor setup — who may', () => {
  it.each([
    ['signed out', 'redirect /admin/login'],
    ['a buyer', 'redirect /'],
  ])('%s is sent away before anything runs', async (_who, to) => {
    requireAdminPendingTwoFactor.mockRejectedValue(new Error(to));
    await expect(startSetupAction({}, form({ password: 'pw-pw-pw-pw' }))).rejects.toThrow(to);
    await expect(confirmSetupAction({}, form({ code: '123456' }))).rejects.toThrow(to);
    expect(allow).not.toHaveBeenCalled();
    expect(enableTwoFactor).not.toHaveBeenCalled();
    expect(verifyTOTP).not.toHaveBeenCalled();
  });

  it('setup uses the pending guard, not requireAdmin (which would loop back to setup)', async () => {
    await startSetupAction({}, form({ password: 'pw-pw-pw-pw' }));
    await confirmSetupAction({}, form({ code: '123456' }));
    expect(requireAdminPendingTwoFactor).toHaveBeenCalledTimes(2);
    expect(requireAdmin).not.toHaveBeenCalled();
  });
});

describe('account — make new backup codes', () => {
  it('returns the new codes once; the log sees none of them', async () => {
    const state = await regenerateBackupCodesAction({}, form({ password: 'correct horse' }));
    expect(state).toEqual({ backupCodes: CODES });
    expect(generateBackupCodes).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: { password: 'correct horse' },
    });
    expect(allow).toHaveBeenCalledWith([
      expect.objectContaining({ scope: 'account:backup-codes', subject: 'raj@example.com' }),
    ]);
    for (const code of CODES) expect(logged()).not.toContain(code);
    expect(logged()).not.toContain('correct horse');
  });

  it('a wrong password is a field error', async () => {
    generateBackupCodes.mockRejectedValue(apiError('INVALID_PASSWORD'));
    const state = await regenerateBackupCodesAction({}, form({ password: 'wrong' }));
    expect(state).toEqual({ error: 'The password is not right.', field: 'password' });
  });

  it('any other failure is not a wrong password', async () => {
    generateBackupCodes.mockRejectedValue(new Error('db down'));
    const state = await regenerateBackupCodesAction({}, form({ password: 'correct horse' }));
    expect(state.field).toBeUndefined();
    expect(state.error).toMatch(/could not be made just now/);
  });

  it('a spent budget refuses without asking better-auth', async () => {
    allow.mockResolvedValue(false);
    const state = await regenerateBackupCodesAction({}, form({ password: 'correct horse' }));
    expect(state.error).toBe('Too many attempts. Please wait a few minutes and try again.');
    expect(generateBackupCodes).not.toHaveBeenCalled();
  });

  it('needs a full admin (two-factor on): requireAdmin, not the pending guard', async () => {
    requireAdmin.mockRejectedValue(new Error('redirect /admin/two-factor/setup'));
    await expect(
      regenerateBackupCodesAction({}, form({ password: 'correct horse' })),
    ).rejects.toThrow('redirect /admin/two-factor/setup');
    expect(generateBackupCodes).not.toHaveBeenCalled();
  });
});
