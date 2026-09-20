import { expect, test, type Page } from '@playwright/test';

// Requires a seeded admin (pnpm admin:create) matching these credentials.
const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'correct-horse-battery';

async function signIn(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  // Six workers share one Node process; a PDF render elsewhere can hold the
  // event loop for seconds, so the sign-in action gets a realistic budget.
  await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
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

  test('rich-text description: formatting survives a save and unsafe HTML does not', async ({
    page,
  }) => {
    await page.goto('/admin/events/new');
    await page.getByLabel('Title', { exact: true }).fill(`Rich text ${Date.now()}`);
    await page.getByLabel(/^Starts at/).fill('2030-10-01T19:00');

    const editor = page.getByLabel('Description');
    await editor.click();
    await page
      .getByRole('toolbar', { name: /formatting/i })
      .getByRole('button', { name: 'Bold' })
      .click();
    await page.keyboard.type('Four acts');
    await page
      .getByRole('toolbar', { name: /formatting/i })
      .getByRole('button', { name: 'Bold' })
      .click();
    await page.keyboard.type(', one night.');
    await page.keyboard.press('Enter');
    await page
      .getByRole('toolbar', { name: /formatting/i })
      .getByRole('button', { name: 'Bullet list' })
      .click();
    await page.keyboard.type('Doors 18:30');
    // Pasted markup is text to the editor; the server strips it regardless.
    await page.keyboard.press('Enter');
    await page.keyboard.type('<script>alert(1)</script>');

    await page.getByRole('button', { name: /create event/i }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/edit$/);

    // Reloaded from the database into the editor, still formatted.
    const saved = page.getByLabel('Description');
    await expect(saved.locator('strong')).toHaveText('Four acts');
    await expect(saved.locator('ul li').first()).toHaveText('Doors 18:30');
    await expect(saved.locator('script')).toHaveCount(0);

    // A blank editor is stored as no description, not an empty paragraph.
    await saved.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByRole('status').filter({ hasText: /event saved/i })).toBeVisible();
    await expect(page.getByLabel('Description')).toHaveText('');
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
