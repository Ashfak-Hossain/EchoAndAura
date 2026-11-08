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

// L3: the order flow in Bangla. A /bn form posts to its /bn path, so the
// action reads the language from the proxy's header: the order is placed
// in Bangla and the buyer lands on the Bangla order page. Bangla digits are
// accepted everywhere a number is typed; what people copy into bKash stays
// in Latin digits.
test('a Bangla buyer registers and pays in Bangla, typing Bangla digits', async ({ page }) => {
  await signInAsAdmin(page);
  const { slug } = await publishedEvent(page, `Bangla order ${Date.now()}`);
  const trxId = `B${Date.now().toString(36).toUpperCase().slice(-9)}`.padEnd(10, 'X');
  const bangla = (s: string) => s.replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]!);

  const register = async (name: string) => {
    await page.goto(`/bn/events/${slug}/register`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('আপনার টিকিট বেছে নিন');
    await page.getByRole('radio', { name: /general/i }).check();
    await page.getByLabel('পুরো নাম').fill(name);
    await page.getByLabel('ইমেইল ঠিকানা').fill('buyer@example.com');
    await page.getByLabel('মোবাইল নম্বর').fill('১৭১২৩');
    await page.getByLabel(/শর্তাবলিতে রাজি/).check();
    await page.getByRole('button', { name: 'পেমেন্টে এগোন' }).click();
    // Refused in Bangla, and nothing typed is lost.
    await expect(page.getByText('বিকাশ নম্বর হয় +880-এর পরে ১০টি অঙ্ক।').first()).toBeVisible();
    await expect(page.getByLabel('পুরো নাম')).toHaveValue(name);

    await page.getByLabel('মোবাইল নম্বর').fill('১৭১২৩৪৫৬৭৮');
    await page.getByRole('button', { name: 'পেমেন্টে এগোন' }).click();
    await expect(page).toHaveURL(/\/bn\/orders\/[0-9a-f-]{36}$/);
    return page.url();
  };

  const first = await register('নুসরাত জাহান');
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  await expect(page.getByRole('heading', { name: 'বিকাশে কীভাবে পেমেন্ট করবেন' })).toBeVisible();
  await expect(page.getByText('পেমেন্টের অপেক্ষায়')).toBeVisible();
  await expect(page.getByText('৳১,২০০.০০').first()).toBeVisible();
  // The reference people paste into bKash stays Latin.
  await expect(page.getByTestId('order-reference')).toHaveText(/^EA-[A-Z0-9]{6}$/);

  // A short TrxID, typed with Bangla digits, is counted in Bangla.
  await page.getByLabel(/বিকাশ ট্রানজেকশন আইডি/).fill(bangla('9AB12'));
  await page.getByLabel('যে নম্বর থেকে পাঠিয়েছেন').fill('০১৭১২৩৪৫৬৭৮');
  await page.getByRole('button', { name: 'আমি টাকা পাঠিয়েছি' }).click();
  await expect(page.getByText(/আপনি লিখেছেন ৫টি/)).toBeVisible();

  // The real one, in Bangla digits: saved in Latin, shown in Latin.
  await page.getByLabel(/বিকাশ ট্রানজেকশন আইডি/).fill(bangla(trxId.toLowerCase()));
  await page.getByRole('button', { name: 'আমি টাকা পাঠিয়েছি' }).click();
  await expect(page.getByRole('heading', { name: 'আপনার পেমেন্ট যাচাই হচ্ছে' })).toBeVisible();
  await expect(page.getByTestId('payment-summary')).toContainText(trxId);
  await expect(page.getByTestId('payment-summary')).toContainText('+880 1712345678');

  // A second order cannot reuse it (Invariant 3), and the page says why in Bangla.
  const second = await register('তানভীর আলম');
  expect(second).not.toBe(first);
  await page.getByLabel(/বিকাশ ট্রানজেকশন আইডি/).fill(trxId);
  await page.getByLabel('যে নম্বর থেকে পাঠিয়েছেন').fill('1712345678');
  await page.getByRole('button', { name: 'আমি টাকা পাঠিয়েছি' }).click();
  await expect(page.getByRole('alert').first()).toContainText(
    'এই ট্রানজেকশন আইডি আগেই ব্যবহার হয়েছে',
  );
  await expect(page.getByText('পেমেন্টের অপেক্ষায়')).toBeVisible();
});
