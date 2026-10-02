import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-048: the find-my-order lookup is a phone-number guess, so it sits
 * behind Turnstile as well as the per-IP limiter. The check, the limiter
 * and the service are mocked; what is under test is the action's wiring
 * and its order: Zod → human check → limiter → service.
 */
const passesHumanCheck = vi.fn<(formData: FormData, action: string) => Promise<boolean>>(
  async () => true,
);
const allow = vi.fn<(rules: { scope: string }[]) => Promise<boolean>>(async () => true);
const findByReferenceAndPhone = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock('@/lib/request-ip', () => ({ requestIp: async () => '203.0.113.7' }));
vi.mock('@/lib/human-check', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/human-check')>()),
  passesHumanCheck,
}));
vi.mock('@/server/lib/rate-limit', () => ({
  createRateLimiter: () => ({ allow }),
  redisRateLimitStore: () => ({}),
}));
vi.mock('@/server/container', () => ({ ordersService: { findByReferenceAndPhone } }));

const { findOrderAction } = await import('@/app/(public)/orders/find/actions');
const { HUMAN_CHECK_FAILED } = await import('@/lib/human-check');

function form(extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    reference: 'ea-7k3m9q',
    phone: '1712345678',
    'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX',
    ...extra,
  })) {
    f.set(k, v);
  }
  return f;
}

beforeEach(() => {
  passesHumanCheck.mockReset().mockResolvedValue(true);
  allow.mockReset().mockResolvedValue(true);
  findByReferenceAndPhone.mockReset();
});

describe('find my order: human check', () => {
  it('a refused check keeps the typed values and touches neither limiter nor service', async () => {
    passesHumanCheck.mockResolvedValue(false);
    const state = await findOrderAction({}, form());
    expect(state).toEqual({
      error: HUMAN_CHECK_FAILED,
      values: { reference: 'ea-7k3m9q', phone: '1712345678' },
    });
    expect(passesHumanCheck).toHaveBeenCalledWith(expect.any(FormData), 'find-order');
    expect(allow).not.toHaveBeenCalled();
    expect(findByReferenceAndPhone).not.toHaveBeenCalled();
  });

  it('an invalid form is answered before the check runs', async () => {
    const state = await findOrderAction({}, form({ phone: '12' }));
    expect(state.error).toBeTruthy();
    expect(state.error).not.toBe(HUMAN_CHECK_FAILED);
    expect(passesHumanCheck).not.toHaveBeenCalled();
    expect(allow).not.toHaveBeenCalled();
  });

  it('a passed check goes on to the limiter, then the service, and redirects', async () => {
    findByReferenceAndPhone.mockResolvedValue({ id: 'o-1' });
    await expect(findOrderAction({}, form())).rejects.toThrow('redirect /orders/o-1');
    expect(allow).toHaveBeenCalledWith([
      { scope: 'find-order:ip', subject: '203.0.113.7', limit: 20, windowSeconds: 60 },
    ]);
    expect(findByReferenceAndPhone).toHaveBeenCalledWith('EA-7K3M9Q', expect.any(String));
    expect(passesHumanCheck.mock.invocationCallOrder[0]).toBeLessThan(
      allow.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('a passed check still meets the limiter', async () => {
    allow.mockResolvedValue(false);
    const state = await findOrderAction({}, form());
    expect(state.error).toBe('Too many attempts. Please wait a minute and try again.');
    expect(findByReferenceAndPhone).not.toHaveBeenCalled();
  });

  it('a passed check with no match gets the one generic refusal', async () => {
    findByReferenceAndPhone.mockResolvedValue(null);
    const state = await findOrderAction({}, form());
    expect(state.error).toMatch(/^No order matches that reference and phone number/);
    expect(state.values).toEqual({ reference: 'ea-7k3m9q', phone: '1712345678' });
  });
});
