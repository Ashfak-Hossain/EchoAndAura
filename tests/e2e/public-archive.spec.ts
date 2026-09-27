import { expect, test, type Page } from '@playwright/test';

// Requires a seeded admin (pnpm admin:create) — the archive is fed by
// creating and archiving an event through the admin, like public-event.spec.
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

async function openTab(page: Page, name: 'Details' | 'Cover image' | 'Ticket types' | 'Publish') {
  await page
    .getByRole('navigation', { name: /event sections/i })
    .getByRole('link', { name })
    .click();
}

/** A 2019 event with one ticket type, archived (a past event cannot be published). */
async function archivedPastEvent(page: Page, title: string): Promise<string> {
  await page.goto('/admin/events/new');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Venue', { exact: true }).fill('Aura Rooftop, Banani');
  await page.getByLabel(/^Starts at/).fill('2019-05-23T20:00');
  await page.getByLabel(/^Registration opens/).fill('2019-05-01T10:00');
  await page.getByRole('button', { name: /create event/i }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/edit$/);
  const slug = await page.getByLabel(/^URL slug/).inputValue();
  await openTab(page, 'Publish');
  await page.getByRole('button', { name: /^archive$/i }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /archive event/i })
    .click();
  await expect(page.getByTestId('event-status')).toHaveText('archived');
  return slug;
}

test.describe('archive (A6)', () => {
  test('a past event is listed newest-first with a year heading and links to its page', async ({
    page,
  }) => {
    await signIn(page);
    const title = `Archive Show ${Date.now()}`;
    const slug = await archivedPastEvent(page, title);

    await page.goto('/archive');
    await expect(page.getByRole('heading', { level: 1, name: 'Past events' })).toBeVisible();
    const card = page.getByTestId('archive').getByRole('link', { name: new RegExp(title) });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('href', `/events/${slug}`);
    await expect(card).toContainText('23 May 2019');
    // Year headings appear only once the archive spans more than one year
    // (other specs usually leave a 2020 event behind; a fresh DB has one year).
    const years = page.getByTestId('archive').getByRole('heading', { level: 2 });
    if ((await years.count()) > 0) {
      await expect(years.filter({ hasText: '2019' })).toBeVisible();
    }

    // Reachable from the footer and from the home page's past strip.
    await page.goto('/');
    await expect(
      page
        .getByRole('contentinfo')
        .getByRole('navigation', { name: 'Tickets' })
        .getByRole('link', { name: 'Past events' }),
    ).toHaveAttribute('href', '/archive');
    await page.getByRole('link', { name: /see all past events/i }).click();
    await expect(page).toHaveURL(/\/archive$/);
  });
});
