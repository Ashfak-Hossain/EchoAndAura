import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-048: the forgot-password action runs the Turnstile check after its
 * Zod parse and before the limiter, so a refused bot spends no admin's
 * reset budget and sends no email. The check, the limiter and better-auth
 * are mocked; what is under test is the action's wiring.
 */
const passesHumanCheck = vi.fn<(formData: FormData, action: string) => Promise<boolean>>();
const allow = vi.fn<(rules: { scope: string }[]) => Promise<boolean>>();
const requestPasswordReset = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/request-ip', () => ({ requestIp: async () => '203.0.113.7' }));
vi.mock('@/lib/auth', () => ({ auth: { api: { requestPasswordReset } } }));
vi.mock('@/lib/human-check', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/human-check')>()),
  passesHumanCheck,
}));
vi.mock('@/server/lib/rate-limit', () => ({
  createRateLimiter: () => ({ allow }),
  redisRateLimitStore: () => ({}),
}));

const { requestPasswordResetAction } = await import('@/app/admin/forgot-password/actions');
const { HUMAN_CHECK_FAILED } = await import('@/lib/human-check');

function form(email: string): FormData {
  const f = new FormData();
  f.set('email', email);
  f.set('cf-turnstile-response', 'XXXX.DUMMY.TOKEN.XXXX');
  return f;
}

beforeEach(() => {
  passesHumanCheck.mockReset().mockResolvedValue(true);
  allow.mockReset().mockResolvedValue(true);
  requestPasswordReset.mockReset().mockResolvedValue({ status: true });
});

describe('forgot password: human check (ADR-048)', () => {
  it('a refused check keeps the address and sends nothing — no limiter, no reset', async () => {
    passesHumanCheck.mockResolvedValue(false);
    const fd = form('raj@example.com');
    const state = await requestPasswordResetAction({}, fd);
    expect(state).toEqual({ error: HUMAN_CHECK_FAILED, email: 'raj@example.com' });
    expect(passesHumanCheck).toHaveBeenCalledWith(fd, 'password-reset');
    expect(allow).not.toHaveBeenCalled();
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it('a passed check goes on to the throttle and the reset as before', async () => {
    const state = await requestPasswordResetAction({}, form('  Raj@Example.com '));
    expect(state).toMatchObject({ sentTo: 'raj@example.com' });
    expect(state.error).toBeUndefined();
    expect(allow).toHaveBeenCalledWith([
      expect.objectContaining({ scope: 'password-reset:ip', subject: '203.0.113.7' }),
      expect.objectContaining({ scope: 'password-reset:email', subject: 'raj@example.com' }),
    ]);
    expect(requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { email: 'raj@example.com', redirectTo: '/admin/reset-password' },
      }),
    );
  });

  it('a passed check still meets the limiter', async () => {
    allow.mockResolvedValue(false);
    const state = await requestPasswordResetAction({}, form('raj@example.com'));
    expect(state.error).toMatch(/Too many reset requests/);
    expect(state.email).toBe('raj@example.com');
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it('an invalid address is answered before the check runs', async () => {
    const state = await requestPasswordResetAction({}, form('not-an-email'));
    expect(state.error).toBeTruthy();
    expect(state.email).toBe('not-an-email');
    expect(passesHumanCheck).not.toHaveBeenCalled();
    expect(allow).not.toHaveBeenCalled();
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });
});
