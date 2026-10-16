import { localeFromPath } from '@/i18n/locales';
import { isMeasuredPath } from '@/lib/web-analytics';
import { expect, test, type Page } from './test';
import { publishedEvent } from './door-helpers';
import { signInAsAdmin } from './fixtures/admin';

// ADR-079: the measured pages are a root layout of their own, so every
// navigation between a measured page and any other loads a new document,
// and the analytics beacon never shares a document with an unmeasured
// page. The suite runs without the beacon (CF_WEB_ANALYTICS_TOKEN is empty):
// what is tested is the boundary itself. A mark on `window` survives an
// in-app navigation and is gone after a page load; the Navigation API lists
// the history entries a document shares, and none may lie across the line.

function measured(url: string): boolean {
  return isMeasuredPath(localeFromPath(new URL(url).pathname).path);
}

interface SharedEntries {
  navigation: { entries(): { url: string | null; sameDocument: boolean }[] };
  __boundaryMark?: true;
}

async function mark(page: Page) {
  await page.evaluate(() => {
    (window as unknown as SharedEntries).__boundaryMark = true;
  });
}

/** The history entries this document shares with the page shown, as full URLs. */
async function sharedEntries(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as unknown as SharedEntries).navigation
      .entries()
      .map((entry) => (entry.sameDocument ? entry.url : null))
      .filter((url): url is string => url !== null),
  );
}

async function expectBoundaryHeld(page: Page) {
  const side = measured(page.url());
  await expect(page.locator('html')).toHaveAttribute('data-root', side ? 'measured' : 'public');
  const across = (await sharedEntries(page)).filter((url) => measured(url) !== side);
  expect(across, 'history entries shared across the analytics boundary').toEqual([]);
}

/** Runs `act`, waits for `url`, and checks whether the page loaded anew. */
async function navigate(
  page: Page,
  act: () => Promise<unknown>,
  url: RegExp,
  newDocument: boolean,
) {
  // A destination the page is already at would pass before `act` lands.
  expect(url.test(page.url()), `already at ${url} before acting`).toBe(false);
  await mark(page);
  await act();
  await expect(page).toHaveURL(url);
  await page.waitForLoadState();
  const kept = await page.evaluate(() => (window as unknown as SharedEntries).__boundaryMark);
  expect(kept === true, newDocument ? 'a new document' : 'the same document').toBe(!newDocument);
  await expectBoundaryHeld(page);
}

const site = (page: Page) => page.getByRole('navigation', { name: 'Site', exact: true });
const home = (page: Page) =>
  page.getByRole('banner').getByRole('link', { name: 'echoandaura, home' });

test.describe('the analytics boundary (ADR-079)', () => {
  test('links across it load a new document; links on one side do not', async ({ page }) => {
    await page.goto('/');
    await navigate(
      page,
      () => site(page).getByRole('link', { name: 'FAQ', exact: true }).click(),
      /\/faq$/,
      false,
    );
    await navigate(
      page,
      () => site(page).getByRole('link', { name: 'Sign in' }).click(),
      /\/account\/sign-in$/,
      true,
    );
    await navigate(
      page,
      () => page.locator('footer').getByRole('link', { name: 'Find my order' }).click(),
      /\/orders\/find$/,
      false,
    );
    await navigate(page, () => home(page).click(), /\/$/, true);
    await navigate(
      page,
      () => page.locator('footer').getByRole('link', { name: 'Find my order' }).click(),
      /\/orders\/find$/,
      true,
    );
    await navigate(
      page,
      () => page.locator('footer').getByRole('link', { name: 'Upcoming events' }).click(),
      /\/events$/,
      true,
    );
  });

  test('the phone menu crosses it with a page load', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/orders/find');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await navigate(page, () => menu.getByRole('link', { name: /^FAQ/ }).click(), /\/faq$/, true);
    await page.getByRole('button', { name: 'Open menu' }).click();
    await navigate(
      page,
      () => menu.getByRole('link', { name: /^Sign in/ }).click(),
      /\/account\/sign-in$/,
      true,
    );
  });

  // The leak ADR-079 closes: an unmeasured entry that a reloaded measured
  // page shared its document with, reached again by Back.
  test('Back and Forward across it load a new document, after a reload too', async ({ page }) => {
    await page.goto('/account/sign-in');
    await navigate(page, () => home(page).click(), /\/$/, true);
    await page.reload();
    await navigate(page, () => page.goBack(), /\/account\/sign-in$/, true);
    await navigate(page, () => page.goForward(), /\/$/, true);
    await navigate(
      page,
      () => site(page).getByRole('link', { name: 'FAQ', exact: true }).click(),
      /\/faq$/,
      false,
    );
    await navigate(page, () => page.goBack(), /\/$/, false);
    await navigate(page, () => page.goBack(), /\/account\/sign-in$/, true);
  });

  test('the language switch keeps each side to itself', async ({ page }) => {
    await page.goto('/orders/find');
    await navigate(
      page,
      () => page.locator('footer').getByRole('button', { name: 'বাংলা' }).click(),
      /\/bn\/orders\/find$/,
      false,
    );
    await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
    await navigate(
      page,
      () => page.locator('footer').getByRole('link', { name: 'সামনের ইভেন্ট' }).click(),
      /\/bn\/events$/,
      true,
    );
    await navigate(
      page,
      () => page.locator('footer').getByRole('button', { name: 'English' }).click(),
      /^https?:\/\/[^/]+\/events$/,
      false,
    );
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('register → order, sign in and sign out cross it with a page load', async ({ page }) => {
    await signInAsAdmin(page);
    const { slug } = await publishedEvent(page, `Boundary ${Date.now()}`);
    await page.context().clearCookies();
    const buyer = `boundary-${Date.now()}@example.com`;

    await page.goto(`/events/${slug}`);
    await navigate(
      page,
      () =>
        page
          .getByRole('link', { name: /^register/i })
          .first()
          .click(),
      /\/register$/,
      true,
    );
    await page.getByRole('radio', { name: /general/i }).check();
    await page.getByLabel('Full name').fill('Farhana Akter');
    await page.getByLabel('Email address').fill(buyer);
    await page.getByLabel('Mobile number').fill('1712345678');
    await page.getByLabel(/I agree to the terms/).check();
    await navigate(
      page,
      () => page.getByRole('button', { name: /continue to payment/i }).click(),
      /\/orders\/[0-9a-f-]{36}$/,
      false,
    );
    await navigate(page, () => home(page).click(), /\/$/, true);
    await navigate(page, () => page.goBack(), /\/orders\/[0-9a-f-]{36}$/, true);

    await page.goto('/account/sign-in');
    await page.getByLabel('Email address').fill(buyer);
    await page.getByRole('button', { name: /email me a sign-in link/i }).click();
    await page.getByTestId('exposed-magic-link').click();
    await expect(page).toHaveURL(/\/account$/);
    await navigate(
      page,
      () => page.getByRole('button', { name: /sign out/i }).click(),
      /\/$/,
      true,
    );
  });

  // A URL no route matches renders global-not-found, never a group's 404:
  // served from the (measured) root it would carry the beacon. `data-root`
  // is the only thing that tells the two apart (both show the same page).
  test('an unknown URL gets the global 404, never a measured root', async ({ page }) => {
    for (const path of [
      '/no-such-page',
      '/bn/no-such-page',
      '/events/no-such-event/register/x',
      '/orders/0b7f4c1e-0000-4000-8000-000000000000/x',
      '/tickets/ABCD-1234/x',
      '/door/x',
      '/api/nope',
    ]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(page.locator('html'), path).toHaveAttribute('data-root', 'global');
    }
    await signInAsAdmin(page);
    expect((await page.goto('/admin/no-such-page'))?.status()).toBe(404);
    await expect(page.locator('html')).toHaveAttribute('data-root', 'global');
  });
});
