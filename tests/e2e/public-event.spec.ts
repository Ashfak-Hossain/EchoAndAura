import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Requires a seeded admin (pnpm admin:create) and MinIO (docker compose).
const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'correct-horse-battery';
const COVER = path.join(__dirname, 'fixtures', 'cover.png');
// Canonical/OG URLs use the configured public origin, not the port under test.
const SITE = (
  process.env.SITE_URL ??
  process.env.BETTER_AUTH_URL ??
  'http://localhost:3000'
).replace(/\/+$/, '');

async function signIn(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  // Six workers share one Node process; a PDF render elsewhere can hold the
  // event loop for seconds, so the sign-in action gets a realistic budget.
  await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
}

async function openTab(page: Page, name: 'Details' | 'Cover image' | 'Ticket types' | 'Publish') {
  await page
    .getByRole('navigation', { name: /event sections/i })
    .getByRole('link', { name })
    .click();
}

/** Creates a publishable event through the admin; returns its slug. */
async function createPublishableEvent(
  page: Page,
  title: string,
  opts: { startsAt?: string; registrationOpensAt?: string; registrationClosesAt?: string } = {},
): Promise<string> {
  await page.goto('/admin/events/new');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Venue', { exact: true }).fill('ICCB Hall 4, Dhaka');
  await page.getByLabel('Description').fill('Four acts, one night, no support slots.');
  await page.getByLabel(/^Starts at/).fill(opts.startsAt ?? '2030-10-01T19:00');
  if (opts.registrationOpensAt) {
    await page.getByLabel(/^Registration opens/).fill(opts.registrationOpensAt);
  }
  if (opts.registrationClosesAt) {
    await page.getByLabel(/^Registration closes/).fill(opts.registrationClosesAt);
  }
  await page.getByRole('button', { name: /create event/i }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/edit$/);
  const slug = await page.getByLabel(/^URL slug/).inputValue();

  for (const [name, price, qty] of [
    ['Early Bird', '800', '100'],
    ['General', '1200', '400'],
    ['VIP', '3500', '50'],
  ]) {
    await openTab(page, 'Ticket types');
    await page
      .getByRole('link', { name: /add ticket type/i })
      .first()
      .click();
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel(/^Price/).fill(price);
    await page.getByLabel('Quantity', { exact: true }).fill(qty);
    await page.getByRole('button', { name: /add ticket type/i }).click();
    await expect(page).toHaveURL(/tab=ticket-types$/);
  }

  await openTab(page, 'Cover image');
  await page.getByTestId('cover-file').setInputFiles(COVER);
  await expect(page.getByTestId('cover-image')).toBeVisible();
  return slug;
}

/** datetime-local value in Dhaka wall time for `date`. */
function dhakaInput(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(' ', 'T');
}

async function publish(page: Page) {
  await openTab(page, 'Publish');
  await page.getByRole('button', { name: /^publish$/i }).click();
  await expect(page.getByTestId('event-status')).toHaveText('published');
}

test.describe('public event page (A2)', () => {
  test('PHASE 2 EXIT: a published event renders with Open Graph tags for Facebook', async ({
    page,
    request,
  }) => {
    await signIn(page);
    const title = `Public Event ${Date.now()}`;
    // Registration must already be open: the default window (20 days before a
    // 2030 event) would put the page in its not_open state.
    const slug = await createPublishableEvent(page, title, {
      registrationOpensAt: '2026-01-01T10:00',
    });

    // Not public while draft.
    expect((await request.get(`/events/${slug}`)).status()).toBe(404);

    await publish(page);
    await page.goto(`/events/${slug}`);

    // Content.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(page.getByText('1 Oct 2030, 19:00 (Dhaka)')).toBeVisible();
    await expect(page.getByText('ICCB Hall 4, Dhaka').first()).toBeVisible();
    await expect(page.getByTestId('event-cover')).toBeVisible();
    // The description is rich text (ADR-010): rendered as a paragraph, not raw markup.
    await expect(page.locator('.rich-text p')).toHaveText(
      'Four acts, one night, no support slots.',
    );
    // Two ticket lists exist (mobile + desktop panel); assert on the visible one.
    const general = page.locator('li:visible').filter({ hasText: 'General' }).first();
    await expect(general).toContainText('৳1,200.00');
    await expect(general).toContainText('400 left');
    await expect(page.getByRole('link', { name: /^register$/i }).first()).toHaveAttribute(
      'href',
      `/events/${slug}/register`,
    );
    await expect(
      page.getByRole('link', { name: /share on facebook|^facebook$/i }).first(),
    ).toHaveAttribute('href', /facebook\.com\/sharer/);

    // Open Graph — what Facebook's crawler reads from the server HTML.
    const meta = (p: string) => page.locator(`head meta[property="${p}"]`).getAttribute('content');
    expect(await meta('og:title')).toBe(title);
    expect(await meta('og:url')).toBe(`${SITE}/events/${slug}`);
    expect(await meta('og:type')).toBe('website');
    expect(await meta('og:image')).toMatch(
      /^http:\/\/localhost:9000\/.+\/events\/.+\/cover-.+\.png$/,
    );
    expect(await meta('og:image:width')).toBe('1200');
    expect(await meta('og:image:height')).toBe('630');
    expect(await meta('og:description')).toContain('Four acts');
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${SITE}/events/${slug}`,
    );
    await expect(page).toHaveTitle(`${title} · echoandaura`);
  });

  test('before registration opens: prices shown, quantities hidden, CTA states the wait', async ({
    page,
  }) => {
    await signIn(page);
    const slug = await createPublishableEvent(page, `Not Open ${Date.now()}`, {
      startsAt: '2030-10-01T19:00',
      registrationOpensAt: '2030-09-11T10:00',
    });
    await publish(page);
    await page.goto(`/events/${slug}`);

    await expect(page.getByRole('status').filter({ hasText: /registration opens/i })).toBeVisible();
    await expect(page.locator('li:visible').filter({ hasText: 'Early Bird' })).toContainText(
      '৳800.00',
    );
    await expect(page.getByText(/\d+ left/)).toHaveCount(0);
    await expect(page.getByText(/^Opens in \d+ days$/).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /^register$/i })).toHaveCount(0);
  });

  test('phones never scroll sideways: the bottom bar fits, open and closing soon', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const open = await createPublishableEvent(page, `Phone Open ${Date.now()}`, {
      registrationOpensAt: '2026-01-01T10:00',
    });
    await publish(page);
    // Closing soon: registration ends within 48 h. The show itself is years
    // out, so it never becomes another spec's home hero.
    const closing = await createPublishableEvent(page, `Phone Closing ${Date.now()}`, {
      registrationOpensAt: '2026-01-01T10:00',
      registrationClosesAt: dhakaInput(new Date(Date.now() + 24 * 3_600_000)),
    });
    await publish(page);

    for (const width of [320, 390]) {
      const phone = await browser.newContext({ viewport: { width, height: 800 } });
      const p = await phone.newPage();
      for (const [slug, label, withPrice] of [
        [open, /^Register$/, true],
        // 550 tickets: the longest label a real show would carry.
        [closing, /^Register — 550 tickets left$/, false],
      ] as const) {
        await p.goto(`/events/${slug}`);
        const bar = p.getByTestId('mobile-cta');
        const button = bar.getByRole('link', { name: label });
        await expect(button).toBeVisible();
        // The whole button and its label sit inside the screen.
        const box = (await button.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(await button.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        expect(
          await p.evaluate(() => document.documentElement.scrollWidth),
          `${slug} at ${width}px scrolls sideways`,
        ).toBe(width);
        // The price rides beside a plain "Register" only while open.
        await expect(bar.locator('..').getByText(/^from ৳/)).toHaveCount(withPrice ? 1 : 0);
      }
      await phone.close();
    }
  });

  test('a past (archived) event keeps its page without a CTA', async ({ page }) => {
    await signIn(page);
    const slug = await createPublishableEvent(page, `Past Event ${Date.now()}`, {
      startsAt: '2020-01-01T19:00',
    });
    // Can't publish a past event; archive keeps the page public.
    await openTab(page, 'Publish');
    await page.getByRole('button', { name: /^archive$/i }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /archive event/i })
      .click();
    await expect(page.getByTestId('event-status')).toHaveText('archived');

    await page.goto(`/events/${slug}`);
    await expect(page.getByText(/^Happened /)).toBeVisible();
    await expect(page.getByRole('link', { name: /^register/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /see upcoming events/i }).first()).toBeVisible();
  });
});
