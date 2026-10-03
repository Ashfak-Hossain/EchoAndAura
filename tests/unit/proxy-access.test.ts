import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-050: the proxy's Access gate. The verifier is mocked (its own test
 * covers the token); what is under test is which requests are checked,
 * where the token is read from, and that a refusal renders nothing.
 */
const verify = vi.fn<(token: string | null | undefined) => Promise<boolean>>();
const readAccessConfig = vi.fn();

vi.mock('@/lib/cf-access', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/cf-access')>()),
  readAccessConfig: () => readAccessConfig(),
  createAccessVerifier: () => ({ verify }),
}));

async function freshProxy() {
  vi.resetModules();
  return (await import('@/proxy')).proxy;
}

function req(path: string, init: { headers?: Record<string, string>; cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  return new NextRequest(new URL(path, 'https://echoandaura.com'), { headers });
}

beforeEach(() => {
  verify.mockReset();
  readAccessConfig.mockReset();
});

describe('proxy — Cloudflare Access on /admin', () => {
  describe('configured', () => {
    beforeEach(() => {
      readAccessConfig.mockReturnValue({ teamDomain: 't.cloudflareaccess.com', aud: 'a' });
    });

    it.each([
      '/admin',
      '/admin/login',
      '/admin/login/verify',
      '/admin/orders',
      '/admin/orders/export.csv',
    ])('refuses %s without a valid token, with a bare 403', async (path) => {
      verify.mockResolvedValue(false);
      const res = await (await freshProxy())(req(path));
      expect(res.status).toBe(403);
      expect(res.headers.get('location')).toBeNull();
    });

    it('reads the token from the header Cloudflare adds', async () => {
      verify.mockResolvedValue(true);
      const res = await (
        await freshProxy()
      )(req('/admin/login', { headers: { 'cf-access-jwt-assertion': 'hdr-token' } }));
      expect(verify).toHaveBeenCalledWith('hdr-token');
      expect(res.status).toBe(200);
    });

    it('falls back to the CF_Authorization cookie', async () => {
      verify.mockResolvedValue(true);
      await (
        await freshProxy()
      )(req('/admin/login', { cookie: 'CF_Authorization=cookie-token' }));
      expect(verify).toHaveBeenCalledWith('cookie-token');
    });

    it('lets a valid token through to the usual session redirect', async () => {
      verify.mockResolvedValue(true);
      const res = await (await freshProxy())(req('/admin/orders'));
      expect(res.headers.get('location')).toBe('https://echoandaura.com/admin/login');
    });

    it.each(['/', '/events/live-dhaka', '/door', '/administrator', '/orders/find'])(
      'leaves %s alone',
      async (path) => {
        const res = await (await freshProxy())(req(path));
        expect(verify).not.toHaveBeenCalled();
        expect(res.status).toBe(200);
      },
    );
  });

  it('checks nothing while Access is not configured', async () => {
    readAccessConfig.mockReturnValue(null);
    const res = await (await freshProxy())(req('/admin/login'));
    expect(verify).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('matches admin prefetches too', async () => {
    const { config } = await import('@/proxy');
    expect(config.matcher).toEqual(expect.arrayContaining(['/admin', '/admin/:path*']));
  });
});
