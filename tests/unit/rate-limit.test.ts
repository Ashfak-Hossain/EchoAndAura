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
    const broken: RateLimitStore = {
      hit: async () => {
        throw new Error('ECONNREFUSED');
      },
    };
    const rule = { scope: 's', subject: 'x', limit: 5, windowSeconds: 60 };
    expect(await createRateLimiter(broken).allow([rule])).toBe(false);
    expect(await createRateLimiter(broken, { onError: 'allow' }).allow([rule])).toBe(true);
  });
});
