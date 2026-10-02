import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-048: the magic-link request runs Zod → human check → throttle →
 * better-auth. A refused check spends no limiter budget and queues no
 * email. The check, limiter and auth are mocked; what is under test is
 * the action's wiring.
 */
const passesHumanCheck = vi.fn<(formData: FormData, action: string) => Promise<boolean>>(
  async () => true,
);
const allow = vi.fn<(rules: { scope: string }[]) => Promise<boolean>>(async () => true);
const signInMagicLink = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({}));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock('@/lib/request-ip', () => ({ requestIp: async () => '203.0.113.7' }));
vi.mock('@/server/lib/rate-limit', () => ({
  createRateLimiter: () => ({ allow }),
  redisRateLimitStore: () => ({}),
}));
vi.mock('@/lib/auth', () => ({ auth: { api: { signInMagicLink, signOut: vi.fn() } } }));
vi.mock('@/server/auth/magic-link', () => ({ takeExposedMagicLink: () => null }));
vi.mock('@/lib/human-check', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/human-check')>()),
  passesHumanCheck,
}));

const { requestSignInLinkAction } = await import('@/app/(public)/account/sign-in/actions');
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
  signInMagicLink.mockReset().mockResolvedValue({});
});

describe('requestSignInLinkAction human check', () => {
  it('a refused check says so, keeps the address, and spends no budget or email', async () => {
    passesHumanCheck.mockResolvedValue(false);
    const f = form(' Nusrat@Example.com ');
    const state = await requestSignInLinkAction({}, f);
    expect(state).toEqual({ error: HUMAN_CHECK_FAILED, values: { email: ' Nusrat@Example.com ' } });
    expect(passesHumanCheck).toHaveBeenCalledWith(f, 'buyer-sign-in');
    expect(allow).not.toHaveBeenCalled();
    expect(signInMagicLink).not.toHaveBeenCalled();
  });

  it('a passed check sends the link as before', async () => {
    const state = await requestSignInLinkAction({}, form(' Nusrat@Example.com '));
    expect(state).toEqual({ sentTo: 'nusrat@example.com', exposedLink: undefined });
    expect(allow).toHaveBeenCalledWith([
      expect.objectContaining({ scope: 'sign-in:ip', subject: '203.0.113.7' }),
      expect.objectContaining({ scope: 'sign-in:email', subject: 'nusrat@example.com' }),
    ]);
    expect(signInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { email: 'nusrat@example.com', callbackURL: '/account' },
      }),
    );
  });

  it('an invalid address never reaches the human check', async () => {
    const state = await requestSignInLinkAction({}, form('not-an-email'));
    expect(state.error).toBe('Enter a complete email address.');
    expect(state.values).toEqual({ email: 'not-an-email' });
    expect(passesHumanCheck).not.toHaveBeenCalled();
    expect(allow).not.toHaveBeenCalled();
  });

  it('a spent budget is still refused after a passed check — no email', async () => {
    allow.mockResolvedValue(false);
    const state = await requestSignInLinkAction({}, form('n@example.com'));
    expect(state.error).toMatch(/Too many sign-in requests/);
    expect(state.values).toEqual({ email: 'n@example.com' });
    expect(signInMagicLink).not.toHaveBeenCalled();
  });
});
