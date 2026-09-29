import { expect, test } from './test';

// ADR-043: the headers every response carries, and the per-request CSP on
// pages. (Every other spec fails on a CSP violation; this one checks the
// headers themselves.)

const STATIC_HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
};

function nonceOf(csp: string | undefined): string | undefined {
  return csp?.match(/'nonce-([^']+)'/)?.[1];
}

test.describe('security headers (ADR-043)', () => {
  for (const path of ['/', '/faq', '/admin/login', '/admin/forgot-password']) {
    test(`${path} sends the static headers and a nonce CSP`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const headers = res.headers();
      expect(headers).toMatchObject(STATIC_HEADERS);
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['permissions-policy']).toContain('camera=()');
      expect(headers['x-powered-by']).toBeUndefined();

      const csp = headers['content-security-policy'];
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("'strict-dynamic'");
      expect(csp).not.toContain('wasm-unsafe-eval');
      // Next stamps the same nonce on its scripts.
      const nonce = nonceOf(csp);
      expect(nonce).toBeTruthy();
      expect(await res.text()).toContain(`nonce="${nonce}"`);
    });
  }

  test('the nonce is new on every request', async ({ request }) => {
    const a = nonceOf((await request.get('/faq')).headers()['content-security-policy']);
    const b = nonceOf((await request.get('/faq')).headers()['content-security-policy']);
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  test('the door keeps its own rules and may compile its decoder', async ({ request }) => {
    const headers = (await request.get('/door')).headers();
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['permissions-policy']).toBe('camera=(self)');
    expect(headers['content-security-policy']).toContain("'wasm-unsafe-eval'");
    expect(headers).toMatchObject(STATIC_HEADERS);
  });

  test('an unknown URL gets the branded 404 with a nonce', async ({ page }) => {
    const res = await page.goto('/no-such-page-anywhere');
    expect(res?.status()).toBe(404);
    expect(nonceOf(res?.headers()['content-security-policy'])).toBeTruthy();
    await expect(page.getByRole('heading', { level: 1, name: /isn.t here/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'See upcoming events' })).toBeVisible();
  });

  test('non-page responses carry no CSP but keep the rest', async ({ request }) => {
    for (const path of ['/api/health', '/door/sw.js']) {
      const headers = (await request.get(path)).headers();
      expect(headers['content-security-policy'], path).toBeUndefined();
      expect(headers['x-content-type-options'], path).toBe('nosniff');
      expect(headers['x-powered-by'], path).toBeUndefined();
    }
  });
});
