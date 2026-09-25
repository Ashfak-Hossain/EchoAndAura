import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Requires a seeded admin (pnpm admin:create) and MinIO (docker compose).
// The event is created and published through the admin, like public-event.spec.
const COVER = path.join(__dirname, 'fixtures', 'cover.png');
const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'correct-horse-battery';
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

test.describe('upcoming events (/events)', () => {
  test('a published upcoming event is listed as a card that links to its page', async ({
    page,
  }) => {
    await signIn(page);
    const title = `Upcoming Show ${Date.now()}`;

    // Registration already open (the default window would close 5 days before).
    await page.goto('/admin/events/new');
    await page.getByLabel('Title', { exact: true }).fill(title);
    await page.getByLabel('Venue', { exact: true }).fill('Bayside Hall, Khulshi, Chattogram');
    await page.getByLabel(/^Starts at/).fill('2030-11-01T19:00');
    await page.getByLabel(/^Registration opens/).fill('2026-01-01T10:00');
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

    // Not listed while it is a draft.
    await page.goto('/events');
    await expect(page.getByRole('link', { name: new RegExp(title) })).toHaveCount(0);

    await page.goto(`${editUrl}?tab=publish`);
    await page.getByRole('button', { name: /^publish$/i }).click();
    await expect(page.getByTestId('event-status')).toHaveText('published');

    await page.goto('/events');
    await expect(page.getByRole('heading', { level: 1, name: 'Upcoming events' })).toBeVisible();
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${SITE}/events`,
    );
    const card = page.getByTestId('upcoming-events').getByRole('link', { name: new RegExp(title) });
    await expect(card).toHaveAttribute('href', `/events/${slug}`);
    await expect(card.getByRole('heading', { level: 2 })).toHaveText(title);
    await expect(card.getByText('On sale', { exact: true })).toBeVisible();
    await expect(card).toContainText('1 Nov 2030, 19:00 (Dhaka)');
    await expect(card).toContainText('Bayside Hall, Khulshi, Chattogram');
    await expect(card).toContainText('From ৳600.00');
    await expect(card.locator('img')).toHaveAttribute('src', /\/cover-.+\.png$/);

    await card.click();
    await expect(page).toHaveURL(new RegExp(`/events/${slug}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  });
});
