import { expect, test } from './test';

/**
 * ADR-061 (L1): the Bangla site's plumbing. /bn pages are the English
 * routes with `lang="bn"`; the switch keeps the page and remembers the
 * choice; a visitor who chose Bangla is sent from an English link to its
 * /bn form. Page text is translated from L2 on.
 */

test('a /bn page is the same page in Bangla, with its own lang and the CSP', async ({ page }) => {
  const res = await page.goto('/bn/faq');
  expect(res?.status()).toBe(200);
  expect(res?.headers()['content-security-policy']).toContain("script-src 'self' 'nonce-");
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/questions people ask/i);
  // Links stay in Bangla.
  await expect(page.locator('footer a[href="/bn/events"]')).toHaveCount(1);

  await page.goto('/faq');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('footer a[href="/events"]')).toHaveCount(1);
});

test('the switch keeps the page, and the choice follows English links', async ({
  page,
  context,
}) => {
  await page.goto('/faq');
  await page.locator('footer').getByRole('button', { name: 'বাংলা' }).click();
  await expect(page).toHaveURL(/\/bn\/faq$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  const cookie = (await context.cookies()).find((c) => c.name === 'ea_lang');
  expect(cookie).toMatchObject({ value: 'bn', httpOnly: true, sameSite: 'Lax' });

  // An English link (shared, bookmarked) opens in Bangla …
  await page.goto('/events?x=1');
  await expect(page).toHaveURL(/\/bn\/events\?x=1$/);
  // … but never the admin or the gate.
  const admin = await page.request.get('/admin/login', { maxRedirects: 0 });
  expect(admin.status()).not.toBe(307);
  expect(admin.headers().location ?? '').not.toContain('/bn');

  await page.locator('footer').getByRole('button', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/events$/);
  await page.goto('/faq');
  await expect(page).toHaveURL(/\/faq$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test("a visitor's own locale header cannot turn an English page Bangla", async ({ request }) => {
  const res = await request.get('/faq', { headers: { 'x-ea-locale': 'bn' } });
  expect(await res.text()).toContain('<html lang="en"');
});
