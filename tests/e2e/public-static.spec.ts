import { expect, test } from '@playwright/test';

// A7: the static pages. No data needed — they read only the environment.
const PAGES = [
  { path: '/about', heading: /small rooms, real sound/i },
  { path: '/faq', heading: /questions people ask/i },
  { path: '/terms', heading: /terms of sale/i },
  { path: '/privacy', heading: /privacy policy/i },
  { path: '/refund', heading: /refund policy/i },
  { path: '/contact', heading: /message the organizer/i },
];

test.describe('static pages (A7)', () => {
  test('every page responds with its heading and is reachable from the footer', async ({
    page,
  }) => {
    for (const { path, heading } of PAGES) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
    await page.goto('/');
    const footer = page.getByRole('navigation', { name: 'Site pages' });
    for (const label of ['About', 'FAQ', 'Terms', 'Privacy', 'Refund policy', 'Contact']) {
      await expect(footer.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
  });

  test('FAQ: one answer open at a time, and a shared anchor opens its answer', async ({ page }) => {
    await page.goto('/faq');
    const first = page.locator('details#when-do-tickets-arrive');
    const second = page.locator('details#wrong-trxid');
    await expect(first).not.toHaveAttribute('open', '');
    await first.locator('summary').click();
    await expect(first).toHaveAttribute('open', '');
    await second.locator('summary').click();
    await expect(second).toHaveAttribute('open', '');
    // Native exclusive accordion (`name="faq"`): opening the second closed the first.
    await expect(first).not.toHaveAttribute('open', '');

    await page.goto('/faq#someone-else');
    await expect(page.locator('details#someone-else')).toHaveAttribute('open', '');
    await expect(page.locator('details#someone-else')).toContainText(/change it on the ticket page/i);
  });
});
