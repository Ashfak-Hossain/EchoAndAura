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

test.describe('admin shell (B2)', () => {
  test('desktop: sidebar links, roadmap items disabled, active item marked', async ({ page }) => {
    await signIn(page);
    const nav = page.getByRole('navigation', { name: 'Admin' });

    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('link', { name: 'Events' })).toBeVisible();

    // Unbuilt sections are visible but not links — no dead ends.
    for (const label of ['Verification', 'Orders', 'Promo codes', 'Reports', 'Settings']) {
      await expect(nav.getByRole('link', { name: label })).toHaveCount(0);
      await expect(nav.locator('[aria-disabled="true"]', { hasText: label })).toBeVisible();
    }

    // Environment chip + signed-in email in the header.
    await expect(page.getByText(/^local$/i)).toBeVisible();
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

    await nav.getByRole('link', { name: 'Events' }).click();
    await expect(page).toHaveURL(/\/admin\/events$/);
    await expect(nav.getByRole('link', { name: 'Events' })).toHaveAttribute('aria-current', 'page');
  });

  test('mobile: sidebar collapses into a sheet that navigates and closes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);

    // No sidebar; the ☰ trigger opens the sheet.
    await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0);
    await page.getByRole('button', { name: /open navigation/i }).click();

    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('link', { name: 'Events' }).click();

    await expect(page).toHaveURL(/\/admin\/events$/);
    await expect(sheet).toHaveCount(0);
  });

  test('events list: status filter tabs carry counts and filter the table', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/events');
    const tabs = page.getByRole('navigation', { name: /filter by status/i });

    await expect(tabs.getByRole('link', { name: /^All/ })).toHaveAttribute('aria-current', 'page');
    await tabs.getByRole('link', { name: /^Archived/ }).click();
    await expect(page).toHaveURL(/status=archived$/);
    await expect(tabs.getByRole('link', { name: /^Archived/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Either rows all show "Archived", or the empty state names the filter.
    const rows = page.getByRole('row').filter({ hasNot: page.getByRole('columnheader') });
    if ((await rows.count()) > 0) {
      for (const row of await rows.all()) await expect(row).toContainText('Archived');
    } else {
      await expect(page.getByText(/no archived events/i)).toBeVisible();
    }
  });
});
