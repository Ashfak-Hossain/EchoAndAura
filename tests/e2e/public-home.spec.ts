import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Requires a seeded admin (pnpm admin:create) and MinIO (docker compose).
const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'correct-horse-battery';
const COVER = path.join(__dirname, 'fixtures', 'cover.png');
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

test.describe('home page (A1)', () => {
  test('the soonest published event is the hero with a live "Get tickets" CTA', async ({
    page,
  }) => {
    await signIn(page);
    const title = `Home Hero ${Date.now()}`;
    const now = Date.now();
    // Starts in two hours: sooner than anything else a shared dev/e2e DB is
    // likely to hold, so it is the hero; closing within 48 h so the chip
    // reads "Closing soon". A leftover from a crashed run expires by itself.
    const startsAt = new Date(now + 2 * 3_600_000);
    const closesAt = new Date(now + 1 * 3_600_000);

    await page.goto('/admin/events/new');
    await page.getByLabel('Title', { exact: true }).fill(title);
    await page.getByLabel('Venue', { exact: true }).fill('Gulshan Society Hall');
    await page.getByLabel(/^Starts at/).fill(dhakaInput(startsAt));
    await page.getByLabel(/^Registration opens/).fill('2026-01-01T10:00');
    await page.getByLabel(/^Registration closes/).fill(dhakaInput(closesAt));
    await page.getByRole('button', { name: /create event/i }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/edit$/);
    const slug = await page.getByLabel(/^URL slug/).inputValue();
    const editUrl = page.url();

    await openTab(page, 'Ticket types');
    await page
      .getByRole('link', { name: /add ticket type/i })
      .first()
      .click();
    await page.getByLabel('Name', { exact: true }).fill('General');
    await page.getByLabel(/^Price/).fill('600');
    await page.getByLabel('Quantity', { exact: true }).fill('120');
    await page.getByRole('button', { name: /add ticket type/i }).click();
    await expect(page).toHaveURL(/tab=ticket-types$/);

    await openTab(page, 'Cover image');
    await page.getByTestId('cover-file').setInputFiles(COVER);
    await expect(page.getByTestId('cover-image')).toBeVisible();

    await openTab(page, 'Publish');
    await page.getByRole('button', { name: /^publish$/i }).click();
    await expect(page.getByTestId('event-status')).toHaveText('published');

    try {
      await page.goto('/');
      const hero = page.getByTestId('home-hero');
      await expect(hero).toHaveAttribute('data-phase', 'closing_soon');
      await expect(hero.getByRole('heading', { level: 1 })).toHaveText(title);
      await expect(hero.getByText('Gulshan Society Hall')).toBeVisible();
      await expect(hero.getByText('from ৳600.00')).toBeVisible();
      await expect(hero.getByText('Closing soon')).toBeVisible();
      await expect(hero.getByTestId('hero-cover')).toBeVisible();
      await expect(hero.getByRole('link', { name: /get tickets/i })).toHaveAttribute(
        'href',
        `/events/${slug}/register`,
      );
      await expect(hero.getByRole('link', { name: /^details$/i })).toHaveAttribute(
        'href',
        `/events/${slug}`,
      );
      await expect(page.getByTestId('home-dormant')).toHaveCount(0);

      // Trust points are always there.
      await expect(page.getByRole('heading', { name: 'Paid by bKash' })).toBeVisible();

      // Share preview of the home page names the next event and uses its cover.
      const meta = (p: string) =>
        page.locator(`head meta[property="${p}"]`).getAttribute('content');
      expect(await meta('og:title')).toBe('echoandaura');
      expect(await meta('og:url')).toBe(SITE);
      expect(await meta('og:description')).toContain(`Next: ${title}`);
      expect(await meta('og:image')).toMatch(/\/cover-.+\.png$/);
      await expect(page).toHaveTitle('echoandaura');
    } finally {
      // Unpublish so a re-run's event (a few minutes later) is the hero next time.
      await page.goto(`${editUrl}?tab=publish`);
      await page.getByRole('button', { name: /^unpublish$/i }).click();
      await expect(page.getByTestId('event-status')).toHaveText('draft');
    }
  });
});
