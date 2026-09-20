import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `requireAdmin` is what every admin server action calls: a buyer session
 * (free to obtain through a magic link) must be sent away, not treated as
 * "a session exists, so this is the admin".
 */
const getSession = vi.fn<() => Promise<unknown>>();
const redirect = vi.fn<(url: string) => never>((url) => {
  throw new Error(`REDIRECT ${url}`);
});

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

describe('requireAdmin', () => {
  beforeEach(() => {
    getSession.mockReset();
    redirect.mockClear();
  });

  it('sends anonymous callers to the admin login', async () => {
    getSession.mockResolvedValue(null);
    const { requireAdmin } = await import('@/lib/session');
    await expect(requireAdmin()).rejects.toThrow('REDIRECT /admin/login');
  });

  it('sends a buyer session home — a session alone is not admin', async () => {
    getSession.mockResolvedValue({
      user: { email: 'buyer@example.com', name: 'Buyer', role: 'buyer' },
    });
    const { requireAdmin } = await import('@/lib/session');
    await expect(requireAdmin()).rejects.toThrow('REDIRECT /');
    expect(redirect).toHaveBeenCalledWith('/');
  });

  it('treats a missing role as buyer, never admin', async () => {
    getSession.mockResolvedValue({ user: { email: 'x@example.com', name: 'X' } });
    const { requireAdmin } = await import('@/lib/session');
    await expect(requireAdmin()).rejects.toThrow('REDIRECT /');
  });

  it('returns the admin', async () => {
    getSession.mockResolvedValue({
      user: { email: 'Raj@Example.com', name: 'Raj', role: 'admin' },
    });
    const { requireAdmin } = await import('@/lib/session');
    await expect(requireAdmin()).resolves.toEqual({
      email: 'raj@example.com',
      name: 'Raj',
      role: 'admin',
    });
    expect(redirect).not.toHaveBeenCalled();
  });
});
