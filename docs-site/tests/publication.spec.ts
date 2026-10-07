import { test, expect } from '@playwright/test';

test('publication metadata stays on the public docs hostname', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain('Sitemap: https://docs.echoandaura.com/sitemap.xml');
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml).toContain('https://docs.echoandaura.com/docs/tours/buy-a-ticket/');
  expect(xml).not.toMatch(/notes|\/infra\/|localhost|pages\.dev/);
  const missing = await request.get('/unknown-publication-page/');
  expect(missing.status()).toBe(404);
});

test('preview mode reports the expected hosting headers', async ({ request }) => {
  for (const path of ['/', '/docs/tours/buy-a-ticket/', '/api/search']) {
    const response = await request.get(path);
    if (process.env.DOCS_PREVIEW_MODE === 'pages') {
      expect(response.headers()['x-content-type-options']).toBe('nosniff');
      expect(response.headers()['x-frame-options']).toBe('DENY');
      expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    } else {
      // A plain file server deliberately does not emulate edge rules. CI runs
      // both modes; the Pages assertions must pass there, never be skipped.
      expect(response.headers()['x-frame-options']).toBeUndefined();
    }
  }
});
