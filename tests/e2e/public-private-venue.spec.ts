import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Requires a seeded admin (pnpm admin:create) and MinIO (docker compose).
const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'correct-horse-battery';
const COVER = path.join(__dirname, 'fixtures', 'cover.png');
const SECRET = 'Warehouse 7, Tejgaon I/A';
const AREA = 'Tejgaon, Dhaka';

async function signIn(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
}

async function openTab(page: Page, name: 'Details' | 'Cover image' | 'Ticket types' | 'Publish') {
  await page
    .getByRole('navigation', { name: /event sections/i })
    .getByRole('link', { name })
    .click();
}

/** Raw server response: covers the HTML and the RSC payload inlined in it. */
async function rawHtml(page: Page, url: string): Promise<string> {
  const res = await page.request.get(url);
  expect(res.status()).toBe(200);
  return res.text();
}

test.describe('private venue (ADR-029)', () => {
  test('public pages show the area, never the venue; the ticket holder gets it', async ({
    page,
  }) => {
    test.slow();
    await signIn(page);

    // Create: private needs a venue — refused without one, input kept.
    await page.goto('/admin/events/new');
    await page.waitForLoadState('networkidle');
    const title = `Secret Set ${Date.now()}`;
    await page.getByLabel('Title', { exact: true }).fill(title);
    await page.getByLabel(/^Starts at/).fill('2030-10-01T19:00');
    await page.getByLabel(/^Registration opens/).fill('2026-01-01T10:00');
    await page.getByLabel(/Keep the venue private/).check();
    await page.getByLabel('Public area (optional)').fill(AREA);
    await page.getByRole('button', { name: /create event/i }).click();
    await expect(page.getByText(/Add the venue to keep it private/)).toBeVisible();
    await expect(page.getByLabel(/Keep the venue private/)).toBeChecked();
    await expect(page.getByLabel('Public area (optional)')).toHaveValue(AREA);

    await page.getByLabel('Venue', { exact: true }).fill(SECRET);
    await page.getByRole('button', { name: /create event/i }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/edit$/, { timeout: 20_000 });
    const id = page.url().match(/\/admin\/events\/([0-9a-f-]{36})\/edit/)![1]!;
    const slug = await page.getByLabel(/^URL slug/).inputValue();
    await expect(page.getByTestId('venue-private-summary')).toContainText(AREA);

    await openTab(page, 'Ticket types');
    await page
      .getByRole('link', { name: /add ticket type/i })
      .first()
      .click();
    await page.getByLabel('Name', { exact: true }).fill('General');
    await page.getByLabel(/^Price/).fill('1200');
    await page.getByLabel('Quantity', { exact: true }).fill('20');
    await page.getByRole('button', { name: /add ticket type/i }).click();
    await openTab(page, 'Cover image');
    await page.getByTestId('cover-file').setInputFiles(COVER);
    await expect(page.getByTestId('cover-image')).toBeVisible();
    await openTab(page, 'Publish');
    await page.getByRole('button', { name: /^publish$/i }).click();
    await expect(page.getByTestId('event-status')).toHaveText('published');

    // Public event page: area + note, no venue, no map.
    await page.goto(`/events/${slug}`);
    await expect(page.getByTestId('event-venue')).toHaveText(AREA);
    await expect(page.getByTestId('event-venue-note')).toHaveText(
      'Exact venue is sent with your tickets',
    );
    await expect(page.getByTestId('event-venue-line')).toContainText(AREA);
    await expect(page.getByRole('link', { name: /Maps/ })).toHaveCount(0);
    for (const url of [`/events/${slug}`, `/events/${slug}/register`, '/', '/archive']) {
      expect(await rawHtml(page, url), url).not.toContain('Warehouse 7');
    }

    // A buyer registers; before approval, nothing reveals it either.
    await page.goto(`/events/${slug}/register`);
    await page.getByRole('radio', { name: /general/i }).check();
    await page.getByLabel('Full name').fill('Nusrat Jahan');
    await page.getByLabel('Email address').fill('buyer@example.com');
    await page.getByLabel('Mobile number').fill('1712345678');
    await page.getByLabel(/I agree to the terms/).check();
    await page.getByRole('button', { name: /continue to payment/i }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    const orderPath = new URL(page.url()).pathname;
    const reference = (await page.getByTestId('order-reference').textContent())!;
    const trxId = `PV${Date.now().toString(36).toUpperCase()}`.slice(0, 10).padEnd(10, 'Z');
    await page.getByLabel(/transaction id \(trxid\)/i).fill(trxId);
    await page.getByLabel('Number you sent from').fill('1712345678');
    await page.getByRole('button', { name: /i have sent the money/i }).click();
    await expect(page.getByText('Checking payment')).toBeVisible();
    expect(await rawHtml(page, orderPath)).not.toContain('Warehouse 7');

    // Approved: the ticket holder gets the venue on the ticket page.
    await page.goto('/admin/verification');
    await page.getByTestId('queue-row').filter({ hasText: reference }).getByRole('link').click();
    await page.getByRole('button', { name: /^approve — /i }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /approve and issue tickets/i })
      .click();
    await expect(page.getByTestId('order-status')).toHaveText('Tickets issued');
    const code = (await page.getByTestId('ticket-row').first().getByRole('link').textContent())!;
    await page.goto(`/tickets/${code.trim()}`);
    await expect(page.getByText(SECRET)).toBeVisible();

    // Made public again: the venue and the map link come back.
    await page.goto(`/admin/events/${id}/edit`);
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/Keep the venue private/).uncheck();
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText('Event saved')).toBeVisible({ timeout: 20_000 });
    await page.goto(`/events/${slug}`);
    await expect(page.getByTestId('event-venue')).toHaveText(SECRET);
    await expect(page.getByTestId('event-venue-note')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Maps/ })).toHaveCount(1);
  });
});
