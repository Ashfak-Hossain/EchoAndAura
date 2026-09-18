import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const COVER_FIXTURE = path.join(__dirname, 'fixtures', 'cover.png');

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

async function createEvent(page: Page, title: string, startsAt = '2030-10-01T19:00') {
  await page.goto('/admin/events/new');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel(/^Starts at/).fill(startsAt);
  await page.getByRole('button', { name: /create event/i }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/edit$/);
}

async function addTicketType(page: Page, name: string, price: string, quantity: string) {
  await page.getByRole('link', { name: /add ticket type/i }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel(/^Price/).fill(price);
  await page.getByLabel('Quantity', { exact: true }).fill(quantity);
  await page.getByRole('button', { name: /add ticket type/i }).click();
  await expect(page).toHaveURL(/\/edit$/);
}

async function uploadCover(page: Page) {
  await page.getByTestId('cover-file').setInputFiles(COVER_FIXTURE);
  await expect(page.getByTestId('cover-image')).toBeVisible();
}

const status = (page: Page) => page.getByTestId('event-status');

test.describe('admin event publishing', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('PHASE 1 EXIT: create an event with three ticket types and publish it', async ({
    page,
  }) => {
    await createEvent(page, `E2E Publish ${Date.now()}`);
    await expect(status(page)).toHaveText('draft');

    // Not ready: no ticket types, no cover → Publish disabled, checklist says why.
    const publish = page.getByRole('button', { name: /^publish$/i });
    await expect(publish).toBeDisabled();
    const checklist = page.getByRole('list', { name: /publish readiness/i });
    await expect(checklist.getByRole('listitem').filter({ hasText: /ticket type/ })).toHaveText(
      /^✗/,
    );
    await expect(checklist.getByRole('listitem').filter({ hasText: /cover image/ })).toHaveText(
      /^✗/,
    );

    await addTicketType(page, 'Early Bird', '800', '100');
    await addTicketType(page, 'General', '1200', '400');
    await addTicketType(page, 'VIP', '3500', '50');
    await uploadCover(page);

    // Ready: every check passes, Publish enabled.
    for (const item of await checklist.getByRole('listitem').all()) {
      await expect(item).toHaveText(/^✓/);
    }
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(status(page)).toHaveText('published');
    await expect(page.getByText(/public page:/i)).toBeVisible();

    // Lifecycle: unpublish → archive → restore, buttons follow the state machine.
    await page.getByRole('button', { name: /^unpublish$/i }).click();
    await expect(status(page)).toHaveText('draft');
    await page.getByRole('button', { name: /^archive$/i }).click();
    await expect(status(page)).toHaveText('archived');
    await expect(page.getByRole('button', { name: /^publish$/i })).toHaveCount(0);
    await page.getByRole('button', { name: /restore to draft/i }).click();
    await expect(status(page)).toHaveText('draft');
    await expect(page.getByRole('button', { name: /^publish$/i })).toBeVisible();

    // Listed with its status.
    await page.goto('/admin/events');
    await expect(page.getByRole('row').filter({ hasText: 'E2E Publish' }).first()).toContainText(
      'draft',
    );
  });

  test('an event that has already started cannot be published', async ({ page }) => {
    await createEvent(page, `E2E Past ${Date.now()}`, '2020-01-01T19:00');
    await addTicketType(page, 'General', '10', '10');
    await uploadCover(page);

    const publish = page.getByRole('button', { name: /^publish$/i });
    await expect(publish).toBeDisabled();
    await expect(publish).toHaveAttribute('title', /start must be in the future/i);
    await expect(
      page
        .getByRole('list', { name: /publish readiness/i })
        .getByRole('listitem')
        .filter({ hasText: /in the future/ }),
    ).toHaveText(/^✗/);
  });
});
