import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * B10 review fix (B1): every code check — Apply, or a submit that carries a
 * code — spends the same per-IP budget, so submitting against a sold-out
 * ticket type is not an unthrottled way to test codes. The limiter and the
 * service are mocked; what is under test is the action's wiring.
 */
const allow = vi.fn(async () => false);
const createOrder = vi.fn();
const checkPromo = vi.fn();

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
vi.mock('@/server/container', () => ({ ordersService: { createOrder, checkPromo } }));

const { registerAction, checkPromoCodeAction } =
  await import('@/app/(public)/events/[slug]/register/actions');

const TT = '5f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';

function form(extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    ticketTypeId: TT,
    quantity: '2',
    buyerName: 'Nusrat Jahan',
    buyerEmail: 'n@example.com',
    buyerPhone: '1712345678',
    terms: 'on',
    ...extra,
  })) {
    f.set(k, v);
  }
  return f;
}

beforeEach(() => {
  allow.mockReset().mockResolvedValue(false);
  createOrder.mockReset();
  checkPromo.mockReset();
});

describe('code checks share one throttle', () => {
  it('a submit carrying a code is refused when the budget is spent — no order is attempted', async () => {
    const state = await registerAction('live-dhaka', {}, form({ promoCode: 'dhaka15' }));
    expect(state.fieldErrors?.promoCode).toBe(
      'Too many tries. Please wait a minute and try again.',
    );
    expect(createOrder).not.toHaveBeenCalled();
    expect(allow).toHaveBeenCalledWith([
      expect.objectContaining({ scope: 'promo-check:ip', subject: '203.0.113.7', limit: 20 }),
    ]);
  });

  it('a submit without a code never touches the promo budget', async () => {
    createOrder.mockResolvedValue({ id: 'o-1' });
    await expect(registerAction('live-dhaka', {}, form())).rejects.toThrow('redirect /orders/o-1');
    expect(allow).not.toHaveBeenCalled();
  });

  it('Apply spends the same budget and says so when it is spent', async () => {
    const r = await checkPromoCodeAction('live-dhaka', { code: 'dhaka15', ticketTypeId: TT });
    expect(r).toMatchObject({ ok: false, reason: 'throttled' });
    expect(checkPromo).not.toHaveBeenCalled();
    expect(allow).toHaveBeenCalledWith([expect.objectContaining({ scope: 'promo-check:ip' })]);
  });

  it('Apply survives a service outage instead of blanking the form', async () => {
    allow.mockResolvedValue(true);
    checkPromo.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await checkPromoCodeAction('live-dhaka', { code: 'dhaka15', ticketTypeId: TT });
    expect(r).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('Apply refuses malformed input before spending the budget', async () => {
    const r = await checkPromoCodeAction('live-dhaka', { code: 'x', ticketTypeId: 'nope' });
    expect(r).toMatchObject({ ok: false, reason: 'invalid_input' });
    expect(allow).not.toHaveBeenCalled();
  });
});
