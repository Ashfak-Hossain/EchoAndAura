import { expect, test } from './test';
import { publishedEvent } from './door-helpers';
import { signInAsAdmin } from './fixtures/admin';

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

test('L2: the shell, home, events, archive and event page read in Bangla, at phone width', async ({
  page,
  browser,
}) => {
  test.slow();
  await signInAsAdmin(page);
  const { slug } = await publishedEvent(page, `Bangla ${Date.now()}`);

  const phone = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const p = await phone.newPage();
  const errors: string[] = [];
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  p.on('pageerror', (e) => errors.push(e.message));

  const pages: { path: string; heading: RegExp }[] = [
    { path: '/bn/events', heading: /সামনের ইভেন্ট/ },
    { path: '/bn/archive', heading: /আগের ইভেন্ট/ },
    { path: `/bn/events/${slug}`, heading: /Bangla/ },
    { path: '/bn', heading: /./ },
  ];
  for (const { path, heading } of pages) {
    await p.goto(path);
    await expect(p.locator('html')).toHaveAttribute('lang', 'bn');
    await expect(p.getByRole('heading', { level: 1 })).toHaveText(heading);
    // The footer is Bangla on every page.
    await expect(p.locator('footer')).toContainText('আমার অর্ডার খুঁজুন');
    // Bangla runs longer: still nothing to scroll sideways at 360 px.
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }

  // The event page: Bangla price digits, Bangla time of day, and the
  // register link stays in Bangla.
  await p.goto(`/bn/events/${slug}`);
  await expect(p.locator('main, article').first()).toContainText('৳১,২০০.০০');
  await expect(p.locator('article')).toContainText('সন্ধ্যা ৭:০০');
  await expect(p.getByTestId('mobile-cta').getByRole('link')).toHaveAttribute(
    'href',
    `/bn/events/${slug}/register`,
  );
  // Server and phone printed the same text: no hydration errors.
  expect(errors.filter((e) => /hydrat|did not match/i.test(e))).toEqual([]);
  await phone.close();
});
