import { describe, expect, it, vi } from 'vitest';
import { createRateLimiter, type RateLimitStore } from '@/server/lib/rate-limit';

vi.mock('@/server/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function memoryStore(): RateLimitStore & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    async hit(key) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return n;
    },
    async peek(key) {
      return counts.get(key) ?? 0;
    },
  };
}

describe('createRateLimiter', () => {
  it('allows up to the limit per subject, then refuses; subjects and scopes are separate', async () => {
    const limiter = createRateLimiter(memoryStore());
    const rule = { scope: 'sign-in:email', limit: 2, windowSeconds: 60 };
    expect(await limiter.allow([{ ...rule, subject: 'a@x.com' }])).toBe(true);
    expect(await limiter.allow([{ ...rule, subject: 'a@x.com' }])).toBe(true);
    expect(await limiter.allow([{ ...rule, subject: 'a@x.com' }])).toBe(false);
    expect(await limiter.allow([{ ...rule, subject: 'b@x.com' }])).toBe(true);
    expect(await limiter.allow([{ ...rule, scope: 'find-order', subject: 'a@x.com' }])).toBe(true);
  });

  it('refuses when any one rule is over, and every call counts against all of them', async () => {
    const store = memoryStore();
    const limiter = createRateLimiter(store);
    const rules = [
      { scope: 'ip', subject: '1.2.3.4', limit: 10, windowSeconds: 60 },
      { scope: 'email', subject: 'a@x.com', limit: 1, windowSeconds: 900 },
    ];
    expect(await limiter.allow(rules)).toBe(true);
    expect(await limiter.allow(rules)).toBe(false);
    expect(store.counts.get('ratelimit:ip:1.2.3.4')).toBe(2);
  });

  it('on a store failure, denies by default and allows only when told to', async () => {
    const refused = async (): Promise<never> => {
      throw new Error('ECONNREFUSED');
    };
    const broken: RateLimitStore = { hit: refused, peek: refused };
    const rule = { scope: 's', subject: 'x', limit: 5, windowSeconds: 60 };
    expect(await createRateLimiter(broken).allow([rule])).toBe(false);
    expect(await createRateLimiter(broken).check([rule])).toBe(false);
    expect(await createRateLimiter(broken, { onError: 'allow' }).allow([rule])).toBe(true);
    expect(await createRateLimiter(broken, { onError: 'allow' }).check([rule])).toBe(true);
  });

  it('check counts nothing and refuses once a rule is at its limit', async () => {
    const store = memoryStore();
    const limiter = createRateLimiter(store);
    const rule = { scope: 'failed', subject: 'a@x.com', limit: 2, windowSeconds: 60 };
    expect(await limiter.check([rule])).toBe(true);
    expect(await limiter.check([rule])).toBe(true);
    expect(store.counts.size).toBe(0);
    await limiter.allow([rule]);
    expect(await limiter.check([rule])).toBe(true);
    await limiter.allow([rule]);
    // Two failures spent a limit of two: the next attempt is refused.
    expect(await limiter.check([rule])).toBe(false);
    expect(store.counts.get('ratelimit:failed:a@x.com')).toBe(2);
  });
});

describe('withTimeout (ADR-038)', () => {
  const never: RateLimitStore = {
    hit: () => new Promise<never>(() => {}),
    peek: () => new Promise<never>(() => {}),
  };

  it('a store that never answers is cut off: a deny limiter refuses, an allow limiter lets through', async () => {
    const { withTimeout } = await import('@/server/lib/rate-limit');
    const rule = { scope: 's', subject: 'x', limit: 5, windowSeconds: 60 };
    const started = Date.now();
    expect(await createRateLimiter(withTimeout(never, 20), { onError: 'deny' }).allow([rule])).toBe(
      false,
    );
    expect(
      await createRateLimiter(withTimeout(never, 20), { onError: 'allow' }).allow([rule]),
    ).toBe(true);
    expect(await createRateLimiter(withTimeout(never, 20), { onError: 'deny' }).check([rule])).toBe(
      false,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('passes a prompt answer through untouched', async () => {
    const { withTimeout } = await import('@/server/lib/rate-limit');
    const store = withTimeout(memoryStore(), 1_000);
    expect(await store.hit('k', 60)).toBe(1);
    expect(await store.hit('k', 60)).toBe(2);
    expect(await store.peek('k')).toBe(2);
  });
});
