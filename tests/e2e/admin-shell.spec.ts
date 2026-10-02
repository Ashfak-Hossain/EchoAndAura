import { expect, test } from './test';
import { E2E_ADMIN, signInAsAdmin } from './fixtures/admin';

test.describe('admin shell (B2)', () => {
  test('desktop: sidebar links, roadmap items disabled, active item marked', async ({ page }) => {
    await signInAsAdmin(page);
    const nav = page.getByRole('navigation', { name: 'Admin' });

    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('link', { name: 'Events' })).toBeVisible();
    // Verification is live since Phase 4 (and is the only item allowed a count badge).
    await expect(nav.getByRole('link', { name: /verification/i })).toHaveAttribute(
      'href',
      '/admin/verification',
    );

    // Orders is live since B9.
    await expect(nav.getByRole('link', { name: 'Orders' })).toHaveAttribute(
      'href',
      '/admin/orders',
    );
    // Every section is live now (Promo codes B10, Sponsors B15, Reports B12, Settings B14).
    for (const [label, href] of [
      ['Promo codes', '/admin/promo-codes'],
      ['Sponsors', '/admin/sponsors'],
      ['Reports', '/admin/reports'],
      ['Settings', '/admin/settings'],
    ] as const) {
      await expect(nav.getByRole('link', { name: label })).toHaveAttribute('href', href);
    }
    // No dead ends: nothing is rendered as a disabled placeholder any more.
    await expect(nav.locator('[aria-disabled="true"]')).toHaveCount(0);

    // Environment chip + signed-in email in the header.
    // The chip reflects APP_ENV (the Playwright web server sets "test").
    await expect(
      page.getByRole('banner').getByText(/^(local|test|staging|production)$/i),
    ).toBeVisible();
    await expect(page.getByText(`Signed in as ${E2E_ADMIN.email}`)).toBeVisible();

    await nav.getByRole('link', { name: 'Events' }).click();
    await expect(page).toHaveURL(/\/admin\/events$/);
    await expect(nav.getByRole('link', { name: 'Events' })).toHaveAttribute('aria-current', 'page');
  });

  test('mobile: sidebar collapses into a sheet that navigates and closes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAsAdmin(page);

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
    await signInAsAdmin(page);
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
