import { expect, test, type Page } from '@playwright/test';

// Requires a seeded admin (pnpm admin:create) matching these credentials.
const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'correct-horse-battery';

async function signIn(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test.describe('admin events', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('create → edit → list round-trip', async ({ page }) => {
    const stamp = Date.now();
    const title = `E2E Event ${stamp}`;

    await page.goto('/admin/events/new');
    await page.getByLabel('Title', { exact: true }).fill(title);
    await page.getByLabel('Venue').fill('Dhaka');
    await page.getByLabel(/^Starts at/).fill('2030-10-01T19:00');
    await page.getByRole('button', { name: /create event/i }).click();

    // Lands on the edit page with the slug derived from the title.
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/edit$/);
    await expect(page.getByLabel(/^URL slug/)).toHaveValue(`e2e-event-${stamp}`);
    await expect(page.getByLabel(/^Starts at/)).toHaveValue('2030-10-01T19:00');
    // Default registration window: 20 / 5 days before.
    await expect(page.getByLabel(/^Registration opens/)).toHaveValue('2030-09-11T19:00');
    await expect(page.getByLabel(/^Registration closes/)).toHaveValue('2030-09-26T19:00');

    // Edit persists.
    await page.getByLabel('Title', { exact: true }).fill(`${title} (edited)`);
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByRole('status').filter({ hasText: /event saved/i })).toBeVisible();
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(`${title} (edited)`);

    // Listed.
    await page.goto('/admin/events');
    await expect(page.getByRole('row').filter({ hasText: `${title} (edited)` })).toBeVisible();
  });

  test('a duplicate slug is rejected by the database and shown inline', async ({ page }) => {
    const slug = `e2e-dup-${Date.now()}`;

    await page.goto('/admin/events/new');
    await page.getByLabel('Title', { exact: true }).fill('Duplicate slug A');
    await page.getByLabel(/^URL slug/).fill(slug);
    await page.getByLabel(/^Starts at/).fill('2030-10-01T19:00');
    await page.getByRole('button', { name: /create event/i }).click();
    await expect(page).toHaveURL(/\/edit$/);

    await page.goto('/admin/events/new');
    await page.getByLabel('Title', { exact: true }).fill('Duplicate slug B');
    await page.getByLabel(/^URL slug/).fill(slug);
    await page.getByLabel(/^Starts at/).fill('2030-10-01T19:00');
    await page.getByRole('button', { name: /create event/i }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: /slug is already in use/i }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/events\/new$/);
  });

  test('cross-field validation blocks an end before the start', async ({ page }) => {
    await page.goto('/admin/events/new');
    await page.getByLabel('Title', { exact: true }).fill('Bad dates');
    await page.getByLabel(/^Starts at/).fill('2030-10-01T19:00');
    await page.getByLabel(/^Ends at/).fill('2030-10-01T18:00');
    await page.getByRole('button', { name: /create event/i }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: /end must be after start/i }),
    ).toBeVisible();
  });

  test('an unknown event id is a 404', async ({ page }) => {
    const response = await page.goto('/admin/events/00000000-0000-0000-0000-000000000000/edit');
    expect(response?.status()).toBe(404);
    const malformed = await page.goto('/admin/events/not-a-uuid/edit');
    expect(malformed?.status()).toBe(404);
  });
});
