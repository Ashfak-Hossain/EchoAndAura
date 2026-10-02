import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError } from 'better-auth/api';

/**
 * ADR-048: the admin login asks Turnstile first, then its own throttle
 * (better-auth's limiter runs only in its HTTP router; `auth.api` calls
 * skip it), then better-auth. The check, the limiter and better-auth are
 * mocked; what is under test is the action's wiring and order.
 */
const passesHumanCheck = vi.fn<(formData: FormData, action: string) => Promise<boolean>>();
type Rule = { scope: string; subject: string; limit: number; windowSeconds: number };
const allow = vi.fn<(rules: Rule[]) => Promise<boolean>>();
const check = vi.fn<(rules: Rule[]) => Promise<boolean>>();
const signInEmail = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock('@/lib/auth', () => ({ auth: { api: { signInEmail } } }));
const requestIp = vi.fn<() => Promise<string>>();
vi.mock('@/lib/request-ip', () => ({ requestIp }));
vi.mock('@/server/lib/rate-limit', () => ({
  createRateLimiter: () => ({ allow, check }),
  redisRateLimitStore: () => ({}),
}));
vi.mock('@/lib/human-check', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/human-check')>()),
  passesHumanCheck,
}));

const { signInAction } = await import('@/app/admin/login/actions');
const { HUMAN_CHECK_FAILED } = await import('@/lib/human-check');

function form(extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    email: ' Raj@Example.com ',
    password: 'correct horse battery',
    ...extra,
  })) {
    f.set(k, v);
  }
  return f;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  // The unit run is not the e2e build; the limiter is on.
  vi.stubEnv('APP_ENV', 'development');
  passesHumanCheck.mockReset().mockResolvedValue(true);
  allow.mockReset().mockResolvedValue(true);
  check.mockReset().mockResolvedValue(true);
  requestIp.mockReset().mockResolvedValue('203.0.113.7');
  signInEmail.mockReset().mockResolvedValue({});
});

describe('admin sign-in — human check (ADR-048)', () => {
  it('a refused check returns the message and the typed email; nothing is counted or tried', async () => {
    passesHumanCheck.mockResolvedValue(false);
    const f = form();
    const state = await signInAction({}, f);
    expect(state).toEqual({ error: HUMAN_CHECK_FAILED, email: ' Raj@Example.com ', refused: true });
    expect(JSON.stringify(state)).not.toContain('correct horse battery');
    expect(passesHumanCheck).toHaveBeenCalledWith(f, 'admin-login');
    expect(allow).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it('an invalid form is answered before the check', async () => {
    const state = await signInAction({}, form({ email: 'not-an-email' }));
    expect(state.error).toBe('Enter a valid email address');
    expect(state.refused).toBeUndefined();
    expect(passesHumanCheck).not.toHaveBeenCalled();
    expect(allow).not.toHaveBeenCalled();
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it('a passed check signs in as before and goes to the console', async () => {
    await expect(signInAction({}, form())).rejects.toThrow('redirect /admin');
    expect(signInEmail).toHaveBeenCalledWith({
      body: { email: 'raj@example.com', password: 'correct horse battery' },
      headers: expect.any(Headers),
    });
  });

  it('wrong credentials keep the generic answer', async () => {
    signInEmail.mockRejectedValue(new APIError('UNAUTHORIZED'));
    const state = await signInAction({}, form());
    expect(state).toEqual({ error: 'Invalid email or password', email: ' Raj@Example.com ' });
  });

  it('an infrastructure failure is not disguised as a bad password', async () => {
    signInEmail.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const state = await signInAction({}, form());
    expect(state.error).toBe('Sign-in is temporarily unavailable. Please try again.');
  });
});

// better-auth's 3 / 10 s rule sits in its HTTP router only, so this form
// had no brute-force limit until the action counted its own attempts.
describe('admin sign-in — throttle', () => {
  const IP_RULE = { scope: 'admin-login:ip', subject: '203.0.113.7', limit: 10, windowSeconds: 60 };
  const FAILED_RULE = {
    scope: 'admin-login:failed',
    subject: '203.0.113.7:raj@example.com',
    limit: 5,
    windowSeconds: 15 * 60,
  };

  it('counts every attempt per IP and checks, without counting, the failures per IP + address', async () => {
    await expect(signInAction({}, form())).rejects.toThrow('redirect /admin');
    expect(allow).toHaveBeenCalledTimes(1);
    expect(allow).toHaveBeenCalledWith([IP_RULE]);
    expect(check).toHaveBeenCalledWith([FAILED_RULE]);
    expect(passesHumanCheck.mock.invocationCallOrder[0]).toBeLessThan(
      allow.mock.invocationCallOrder[0]!,
    );
  });

  it('a wrong password is counted against that IP + address', async () => {
    signInEmail.mockRejectedValue(new APIError('UNAUTHORIZED'));
    await signInAction({}, form());
    expect(allow).toHaveBeenCalledTimes(2);
    expect(allow).toHaveBeenLastCalledWith([FAILED_RULE]);
  });

  it('an infrastructure failure is not counted as a wrong password', async () => {
    signInEmail.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await signInAction({}, form());
    expect(allow).toHaveBeenCalledTimes(1);
  });

  it('a spent IP budget refuses without asking better-auth; the email is kept', async () => {
    allow.mockResolvedValue(false);
    const state = await signInAction({}, form());
    expect(state).toEqual({
      error: 'Too many sign-in attempts. Please wait a few minutes and try again.',
      email: ' Raj@Example.com ',
      refused: true,
    });
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it('spent failures for this IP + address refuse without asking better-auth', async () => {
    check.mockResolvedValue(false);
    const state = await signInAction({}, form());
    expect(state.error).toBe('Too many sign-in attempts. Please wait a few minutes and try again.');
    expect(state.refused).toBe(true);
    expect(signInEmail).not.toHaveBeenCalled();
  });

  // The lockout this guards against: an attacker who passes Turnstile
  // spends the address's failures from their own IP; the admin, from
  // another, still gets in with the right password.
  it("another IP's wrong passwords never lock the admin out", async () => {
    const failures = new Map<string, number>();
    allow.mockImplementation(async (rules) => {
      for (const r of rules) {
        if (r.scope === 'admin-login:failed') {
          failures.set(r.subject, (failures.get(r.subject) ?? 0) + 1);
        }
      }
      return true;
    });
    check.mockImplementation(async (rules) =>
      rules.every((r) => (failures.get(r.subject) ?? 0) < r.limit),
    );

    requestIp.mockResolvedValue('198.51.100.66');
    signInEmail.mockRejectedValue(new APIError('UNAUTHORIZED'));
    for (let i = 0; i < 5; i++) {
      expect((await signInAction({}, form({ password: `wrong-guess-${i}` }))).error).toBe(
        'Invalid email or password',
      );
    }
    // The attacker's own IP is now spent for this address.
    expect((await signInAction({}, form({ password: 'wrong-guess-5' }))).refused).toBe(true);

    requestIp.mockResolvedValue('203.0.113.7');
    signInEmail.mockReset().mockResolvedValue({});
    await expect(signInAction({}, form())).rejects.toThrow('redirect /admin');
    expect(signInEmail).toHaveBeenCalledTimes(1);
  });

  it('is off for the e2e suite (APP_ENV=test)', async () => {
    vi.stubEnv('APP_ENV', 'test');
    allow.mockResolvedValue(false);
    check.mockResolvedValue(false);
    await expect(signInAction({}, form())).rejects.toThrow('redirect /admin');
    expect(allow).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });
});
