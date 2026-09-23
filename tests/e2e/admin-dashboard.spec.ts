import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Requires a seeded admin (pnpm admin:create) and MinIO (docker compose).
const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'correct-horse-battery';
const COVER = path.join(__dirname, 'fixtures', 'cover.png');

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

/** A published event with one ticket type General (৳1,200 × 20). */
async function publishedEvent(page: Page, title: string) {
  await page.goto('/admin/events/new');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Venue', { exact: true }).fill('ICCB Hall 4, Dhaka');
  await page.getByLabel(/^Starts at/).fill('2030-10-01T19:00');
  await page.getByLabel(/^Registration opens/).fill('2026-01-01T10:00');
  await page.getByRole('button', { name: /create event/i }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/edit$/, { timeout: 20_000 });
  const slug = await page.getByLabel(/^URL slug/).inputValue();
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
  return slug;
}

const count = async (page: Page, testId: string) =>
  Number((await page.getByTestId(testId).textContent())!.replace(/[^\d]/g, ''));

test.describe('dashboard (B3)', () => {
  test('a new order shows up live; approving it moves revenue', async ({ page }) => {
    test.slow();
    await signIn(page);
    const title = `Dash ${Date.now()}`;
    const slug = await publishedEvent(page, title);
    const eventCard = page.getByRole('region', { name: title });

    await page.goto('/admin');
    await expect(eventCard.getByTestId('event-revenue')).toHaveText('৳0.00');

    // A buyer registers.
    await page.goto(`/events/${slug}/register`);
    await page.getByRole('radio', { name: /general/i }).check();
    await page.getByLabel('Full name').fill('Nusrat Jahan');
    await page.getByLabel('Email address').fill('buyer@example.com');
    await page.getByLabel('Mobile number').fill('1712345678');
    await page.getByLabel(/I agree to the terms/).check();
    await page.getByRole('button', { name: /continue to payment/i }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    const orderId = page.url().split('/').at(-1)!;
    const reference = (await page.getByTestId('order-reference').textContent())!;

    // The dashboard sees it straight away: today's count, the newest rows.
    await page.goto('/admin');
    expect(await count(page, 'orders-today')).toBeGreaterThanOrEqual(1);
    const row = page.getByTestId('recent-orders').getByText(reference).first();
    await expect(row).toBeVisible();
    await expect(page.getByTestId('recent-orders')).toContainText('Awaiting payment');
    const revenueBefore = await count(page, 'revenue-today');

    // Pay and approve: revenue today and the event's revenue include it.
    await page.goto(`/orders/${orderId}`);
    const trxId = `DB${Date.now().toString(36).toUpperCase()}`.slice(0, 10).padEnd(10, 'Z');
    await page.getByLabel(/transaction id \(trxid\)/i).fill(trxId);
    await page.getByLabel('Number you sent from').fill('1712345678');
    await page.getByRole('button', { name: /i have sent the money/i }).click();
    await expect(page.getByText('Checking payment')).toBeVisible();
    await page.goto(`/admin/orders/${orderId}`);
    await page.getByRole('button', { name: /^approve — /i }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /approve and issue tickets/i })
      .click();
    await expect(page.getByTestId('order-status')).toHaveText('Tickets issued');

    await page.goto('/admin');
    await expect(eventCard.getByTestId('event-revenue')).toHaveText('৳1,200.00');
    expect(await count(page, 'revenue-today')).toBeGreaterThanOrEqual(revenueBefore + 120_000);
  });
});
