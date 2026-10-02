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
      user: { email: 'Raj@Example.com', name: 'Raj', role: 'admin', twoFactorEnabled: true },
    });
    const { requireAdmin } = await import('@/lib/session');
    await expect(requireAdmin()).resolves.toEqual({
      email: 'raj@example.com',
      name: 'Raj',
      role: 'admin',
      twoFactorEnabled: true,
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  // ADR-049: a password alone is not enough.
  it('sends an admin without two-factor to the setup page', async () => {
    getSession.mockResolvedValue({
      user: { email: 'raj@example.com', name: 'Raj', role: 'admin', twoFactorEnabled: false },
    });
    const { requireAdmin } = await import('@/lib/session');
    await expect(requireAdmin()).rejects.toThrow('REDIRECT /admin/two-factor/setup');
  });

  it('treats a missing twoFactorEnabled as off, never on', async () => {
    getSession.mockResolvedValue({
      user: { email: 'raj@example.com', name: 'Raj', role: 'admin' },
    });
    const { requireAdmin } = await import('@/lib/session');
    await expect(requireAdmin()).rejects.toThrow('REDIRECT /admin/two-factor/setup');
  });
});

describe('requireAdminPendingTwoFactor', () => {
  beforeEach(() => {
    getSession.mockReset();
    redirect.mockClear();
  });

  it('returns an admin who has not set up two-factor yet (the setup page only)', async () => {
    getSession.mockResolvedValue({
      user: { email: 'raj@example.com', name: 'Raj', role: 'admin', twoFactorEnabled: false },
    });
    const { requireAdminPendingTwoFactor } = await import('@/lib/session');
    await expect(requireAdminPendingTwoFactor()).resolves.toMatchObject({
      role: 'admin',
      twoFactorEnabled: false,
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('still refuses a buyer and an anonymous caller', async () => {
    const { requireAdminPendingTwoFactor } = await import('@/lib/session');
    getSession.mockResolvedValue({ user: { email: 'b@example.com', name: 'B', role: 'buyer' } });
    await expect(requireAdminPendingTwoFactor()).rejects.toThrow('REDIRECT /');
    getSession.mockResolvedValue(null);
    await expect(requireAdminPendingTwoFactor()).rejects.toThrow('REDIRECT /admin/login');
  });
});
