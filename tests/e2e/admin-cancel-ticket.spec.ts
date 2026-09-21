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

/** A published event with one ticket type General (৳1,200 × 20). Returns { id, slug }. */
async function publishedEvent(page: Page, title: string) {
  await page.goto('/admin/events/new');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Venue').fill('ICCB Hall 4, Dhaka');
  await page.getByLabel(/^Starts at/).fill('2030-10-01T19:00');
  await page.getByLabel(/^Registration opens/).fill('2026-01-01T10:00');
  await page.getByRole('button', { name: /create event/i }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/edit$/);
  const id = page.url().match(/\/admin\/events\/([0-9a-f-]{36})\/edit/)![1]!;
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
  return { id, slug };
}

/** Registers `quantity` tickets, submits a trxID and approves on B8; leaves the page on B8. */
async function issuedOrder(page: Page, slug: string, name: string, quantity: number) {
  await page.goto(`/events/${slug}/register`);
  await page.getByRole('radio', { name: /general/i }).check();
  for (let i = 1; i < quantity; i++) {
    await page.getByRole('button', { name: /more tickets/i }).click();
  }
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email address').fill('buyer@example.com');
  await page.getByLabel('Mobile number').fill('1712345678');
  await page.getByLabel(/I agree to the terms/).check();
  await page.getByRole('button', { name: /continue to payment/i }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  const reference = (await page.getByTestId('order-reference').textContent())!;
  const trxId = `CX${Date.now().toString(36).toUpperCase()}`.slice(0, 10).padEnd(10, 'Z');
  await page.getByLabel(/transaction id \(trxid\)/i).fill(trxId);
  await page.getByLabel('Number you sent from').fill('1712345678');
  await page.getByRole('button', { name: /i have sent the money/i }).click();
  await expect(page.getByText('Checking payment')).toBeVisible();

  await page.goto('/admin/verification');
  await page.getByTestId('queue-row').filter({ hasText: reference }).getByRole('link').click();
  await expect(page).toHaveURL(/\/admin\/orders\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: /^approve — /i }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /approve and issue tickets/i })
    .click();
  await expect(page.getByTestId('order-status')).toHaveText('Tickets issued');
  const codes = await page.getByTestId('ticket-row').allTextContents();
  return {
    reference,
    orderUrl: page.url().replace(/\?.*$/, ''),
    codes: codes.map((t) => t.match(/TKT-[A-Z2-9]{8}/)![0]),
  };
}

const stockRow = (page: Page) => page.locator('li:visible').filter({ hasText: 'General' }).first();

test.describe('cancel ticket (B8)', () => {
  test('cancelling releases one seat, the last one cancels the order; every step is audited', async ({
    page,
  }) => {
    test.slow();
    await signIn(page);
    const { id, slug } = await publishedEvent(page, `Cancel ${Date.now()}`);
    const { orderUrl, codes } = await issuedOrder(page, slug, 'Nusrat Jahan', 2);
    expect(codes).toHaveLength(2);

    // 2 sold of 20.
    await page.goto(`/events/${slug}`);
    await expect(stockRow(page)).toContainText('18 left');

    // Cancel ticket 1: the reason is required.
    await page.goto(orderUrl);
    const rows = page.getByTestId('ticket-row');
    await expect(rows).toHaveCount(2);
    await rows.nth(0).getByRole('button', { name: 'Cancel' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`Cancel ticket ${codes[0]}?`);
    await expect(dialog).not.toContainText('last live ticket');
    // Browser validation blocks an empty reason; a one-character one reaches the server rule.
    await dialog.getByLabel(/^Reason/).fill('x');
    await dialog.getByRole('button', { name: 'Cancel ticket' }).click();
    await expect(dialog.getByRole('alert')).toContainText(/say why/i);
    await dialog.getByLabel(/^Reason/).fill('Buyer asked; refunded ৳1,200 by bKash');
    await dialog.getByRole('button', { name: 'Cancel ticket' }).click();

    await expect(page).toHaveURL(new RegExp(`cancelled=${codes[0]}`));
    await expect(page.getByRole('status')).toContainText(`Ticket ${codes[0]} cancelled`);
    await expect(page.getByRole('status')).not.toContainText('order is cancelled');
    await expect(page.getByTestId('order-status')).toHaveText('Tickets issued');
    await expect(page.getByText('1 issued · 1 cancelled')).toBeVisible();
    await expect(rows.nth(0)).toContainText('Cancelled');
    await expect(rows.nth(0).getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    await expect(rows.nth(1).getByRole('button', { name: 'Cancel' })).toHaveCount(1);
    await expect(page.getByText('ticket.cancelled')).toBeVisible();
    await expect(
      page.getByText(`${codes[0]} (Nusrat Jahan): Buyer asked; refunded ৳1,200 by bKash`),
    ).toBeVisible();

    // The seat is back on sale; the ticket page shows the stamp and no rename.
    await page.goto(`/events/${slug}`);
    await expect(stockRow(page)).toContainText('19 left');
    await page.goto(`/tickets/${codes[0]}`);
    await expect(page.getByTestId('ticket')).toHaveAttribute('data-status', 'cancelled');
    await expect(page.getByRole('button', { name: 'Edit name' })).toHaveCount(0);
    await page.goto(`/tickets/${codes[1]}`);
    await expect(page.getByTestId('ticket')).toHaveAttribute('data-status', 'issued');

    // The door list drops it and says so.
    await page.goto(`/admin/events/${id}/check-in`);
    await expect(page.getByTestId('check-in-row')).toHaveCount(1);
    await expect(page.getByTestId('check-in-row').first()).toContainText(codes[1]!);
    await expect(page.getByText('1 cancelled ticket not listed')).toBeVisible();

    // Cancel ticket 2: the last live ticket takes the order with it.
    await page.goto(orderUrl);
    await rows.nth(1).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toContainText('last live ticket');
    await page
      .getByRole('dialog')
      .getByLabel(/^Reason/)
      .fill('Event moved, full refund');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel ticket' }).click();
    await expect(page).toHaveURL(/order=cancelled/);
    await expect(page.getByRole('status')).toContainText('the order is cancelled');
    await expect(page.getByTestId('order-status')).toHaveText('Cancelled');
    await expect(page.getByTestId('order-readonly')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /re-send/i })).toHaveCount(0);
    await expect(page.getByText('order.cancelled')).toBeVisible();
    await expect(page.getByText('all 2 tickets cancelled')).toBeVisible();

    await page.goto(`/events/${slug}`);
    await expect(stockRow(page)).toContainText('20 left');
    await page.goto(`/admin/events/${id}/check-in`);
    await expect(page.getByText('No tickets issued yet').first()).toBeVisible();
    await expect(page.getByText('2 cancelled tickets not listed')).toBeVisible();
  });
});
