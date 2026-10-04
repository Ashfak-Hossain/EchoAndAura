import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * B10 review fix (B1): every code check — Apply, or a submit that carries a
 * code — spends the same per-IP budget, so submitting against a sold-out
 * ticket type is not an unthrottled way to test codes. The limiter and the
 * service are mocked; what is under test is the action's wiring.
 */
const allow = vi.fn<(rules: { scope: string }[]) => Promise<boolean>>(async () => false);
const createOrder = vi.fn();
const checkPromo = vi.fn();
const passesHumanCheck = vi.fn<(formData: FormData, action: string) => Promise<boolean>>(
  async () => true,
);

const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }));
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
vi.mock('@/lib/human-check', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/human-check')>()),
  passesHumanCheck,
}));

const { registerAction, checkPromoCodeAction } =
  await import('@/app/(public)/events/[slug]/register/actions');
const { SoldOutError, TooManyOpenOrdersError } = await import('@/server/lib/errors');
const { HUMAN_CHECK_FAILED } = await import('@/lib/human-check');

/** The order limiter says yes, the promo budget is spent: they are separate. */
const onlyOrdersAllowed = async (rules: { scope: string }[]) =>
  rules[0]?.scope === 'order-create:ip';
const scopes = () => allow.mock.calls.map(([rules]) => rules[0]?.scope);

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
  passesHumanCheck.mockReset().mockResolvedValue(true);
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
    allow.mockImplementation(onlyOrdersAllowed);
    createOrder.mockResolvedValue({ id: 'o-1' });
    await expect(registerAction('live-dhaka', {}, form())).rejects.toThrow('redirect /orders/o-1');
    expect(scopes()).toEqual(['order-create:ip']);
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

// Phase 7.6 (ADR-046): every order holds seats, so placing them is limited
// per network as well as per phone (the service's cap).
describe('placing orders is limited per network', () => {
  it('spends 20 per IP per 15 minutes and refuses beyond it without touching the service', async () => {
    const state = await registerAction('live-dhaka', {}, form());
    expect(state.banner?.title).toBe('Too many orders from this network');
    expect(state.values).toMatchObject({ buyerName: 'Nusrat Jahan' });
    expect(createOrder).not.toHaveBeenCalled();
    expect(allow).toHaveBeenCalledWith([
      {
        scope: 'order-create:ip',
        subject: '203.0.113.7',
        limit: 20,
        windowSeconds: 15 * 60,
      },
    ]);
  });

  it('an invalid form is answered before spending the budget', async () => {
    const state = await registerAction('live-dhaka', {}, form({ buyerPhone: '12' }));
    expect(state.fieldErrors?.buyerPhone).toBeTruthy();
    expect(allow).not.toHaveBeenCalled();
  });

  it('is off for the e2e suite (APP_ENV=test), like the sign-in limiter', async () => {
    vi.stubEnv('APP_ENV', 'test');
    try {
      createOrder.mockResolvedValue({ id: 'o-2' });
      await expect(registerAction('live-dhaka', {}, form())).rejects.toThrow(
        'redirect /orders/o-2',
      );
      expect(allow).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('a phone at its open-order cap gets a banner that says what to do', async () => {
    allow.mockImplementation(onlyOrdersAllowed);
    createOrder.mockRejectedValue(new TooManyOpenOrdersError(2));
    const state = await registerAction('live-dhaka', {}, form());
    expect(state.banner?.title).toBe('You already have orders waiting for this event');
    expect(state.banner?.body).toMatch(/2 orders waiting/);
    expect(state.banner?.body).toMatch(/Find my order/);
  });
});

// ADR-048: a refused Turnstile token is answered before anything that
// costs a real buyer — the limiter budgets, or seats held for 20 minutes.
describe('the human check comes first', () => {
  it('a refused check keeps the input and touches neither limiter nor the service', async () => {
    passesHumanCheck.mockResolvedValue(false);
    const f = form({ promoCode: 'dhaka15' });
    const state = await registerAction('live-dhaka', {}, f);
    expect(state.banner?.body).toBe(HUMAN_CHECK_FAILED);
    expect(state.values).toMatchObject({ buyerName: 'Nusrat Jahan', promoCode: 'dhaka15' });
    expect(passesHumanCheck).toHaveBeenCalledWith(f, 'register');
    expect(allow).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('a passed check places the order as before', async () => {
    allow.mockResolvedValue(true);
    createOrder.mockResolvedValue({ id: 'o-3' });
    await expect(registerAction('live-dhaka', {}, form({ promoCode: 'dhaka15' }))).rejects.toThrow(
      'redirect /orders/o-3',
    );
    expect(scopes()).toEqual(['promo-check:ip', 'order-create:ip']);
    expect(passesHumanCheck.mock.invocationCallOrder[0]).toBeLessThan(
      allow.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('an invalid form is answered without asking Cloudflare', async () => {
    const state = await registerAction('live-dhaka', {}, form({ buyerPhone: '12' }));
    expect(state.fieldErrors?.buyerPhone).toBeTruthy();
    expect(passesHumanCheck).not.toHaveBeenCalled();
  });

  it('Apply is not behind the check', async () => {
    allow.mockResolvedValue(true);
    checkPromo.mockResolvedValue({ ok: false, reason: 'unknown' });
    await checkPromoCodeAction('live-dhaka', { code: 'dhaka15', ticketTypeId: TT });
    expect(checkPromo).toHaveBeenCalled();
    expect(passesHumanCheck).not.toHaveBeenCalled();
  });
});

// ADR-055: with counts hidden the buyer may ask for more than remain. Only a
// refused single ticket proves the type is gone; a larger refusal keeps the
// row choosable so they can try fewer.
describe('a refused hold says what the buyer can do next', () => {
  beforeEach(() => {
    revalidatePath.mockClear();
    allow.mockImplementation(onlyOrdersAllowed);
  });

  it('one ticket refused: the type sold out, and the form disables that row', async () => {
    createOrder.mockRejectedValue(new SoldOutError(TT, 1));
    const state = await registerAction('live-dhaka', {}, form({ quantity: '1' }));
    expect(state.banner?.title).toBe('That ticket type sold out while you were choosing');
    expect(state.banner?.soldOutTicketTypeId).toBe(TT);
    expect(state.values).toMatchObject({ buyerName: 'Nusrat Jahan' });
    expect(revalidatePath).toHaveBeenCalledWith('/events/live-dhaka/register');
  });

  it('several refused: "not that many left", and the row stays choosable', async () => {
    createOrder.mockRejectedValue(new SoldOutError(TT, 3));
    const state = await registerAction('live-dhaka', {}, form({ quantity: '3' }));
    expect(state.banner?.title).toBe('Not that many tickets are left');
    expect(state.banner?.body).toMatch(/Choose fewer tickets/);
    expect(state.banner).not.toHaveProperty('soldOutTicketTypeId');
    // Never a number: the event may hide its counts.
    expect(`${state.banner?.title} ${state.banner?.body}`).not.toMatch(/\d/);
    expect(state.values).toMatchObject({ quantity: '3' });
    // Today's numbers for the form, so it never says "3 left" beside the banner.
    expect(revalidatePath).toHaveBeenCalledWith('/events/live-dhaka/register');
  });
});
