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
  await expect(page).toHaveURL(/\/admin$/);
}

async function openTab(page: Page, name: 'Details' | 'Cover image' | 'Ticket types' | 'Publish') {
  await page
    .getByRole('navigation', { name: /event sections/i })
    .getByRole('link', { name })
    .click();
}

/** A published event with one ticket type General (৳1,200 × 20). Returns its slug. */
async function publishedEvent(page: Page, title: string): Promise<string> {
  await page.goto('/admin/events/new');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Venue').fill('ICCB Hall 4, Dhaka');
  await page.getByLabel(/^Starts at/).fill('2030-10-01T19:00');
  await page.getByLabel(/^Registration opens/).fill('2026-01-01T10:00');
  await page.getByRole('button', { name: /create event/i }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/edit$/);
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

/** Registers `quantity` tickets and submits a trxID; returns the buyer's order URL + reference. */
async function paidOrder(page: Page, slug: string, name: string, quantity: number, trxId: string) {
  await page.goto(`/events/${slug}/register`);
  await page.getByRole('radio', { name: /general/i }).check();
  for (let i = 1; i < quantity; i++) {
    await page.getByRole('button', { name: /more tickets/i }).click();
  }
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email address').fill('buyer@example.com');
  await page.getByLabel('Mobile number').fill('1712345678');
  for (let i = 1; i <= quantity; i++) {
    await page.getByLabel(`Ticket ${i} — attendee name`).fill(`${name} ${i}`);
  }
  await page.getByLabel(/I agree to the terms/).check();
  await page.getByRole('button', { name: /continue to payment/i }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  const url = page.url();
  const reference = await page.getByTestId('order-reference').textContent();
  await page.getByLabel(/transaction id \(trxid\)/i).fill(trxId);
  await page.getByLabel('Number you sent from').fill('1712345678');
  await page.getByRole('button', { name: /i have sent the money/i }).click();
  await expect(page.getByText('Checking payment')).toBeVisible();
  return { url, reference: reference! };
}

const stamp = () => Date.now().toString(36).toUpperCase().slice(-7);

test.describe('verification (B7 → B8) and fulfilment', () => {
  test('PHASE 4 CORE: approve issues tickets and converts the hold to sales; reject releases with a reason', async ({
    page,
  }) => {
    await signIn(page);
    const slug = await publishedEvent(page, `Verify ${Date.now()}`);

    const a = await paidOrder(page, slug, 'Nusrat Jahan', 2, `APR${stamp()}`);
    const b = await paidOrder(page, slug, 'Tanvir Alam', 1, `REJ${stamp()}`);

    // B7: both wait, oldest first; the nav badge counts them.
    await page.goto('/admin/verification');
    await expect(page.getByText(/\d+ waiting · oldest/)).toBeVisible();
    const rows = page.getByTestId('queue-row');
    await expect(rows.filter({ hasText: a.reference })).toBeVisible();
    await expect(rows.filter({ hasText: b.reference })).toBeVisible();
    const aIndex = (await rows.allTextContents()).findIndex((t) => t.includes(a.reference));
    const bIndex = (await rows.allTextContents()).findIndex((t) => t.includes(b.reference));
    expect(aIndex).toBeLessThan(bIndex);
    await expect(
      page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: /verification/i }),
    ).toContainText(/\d+/);

    // B8: approve A.
    await rows.filter({ hasText: a.reference }).getByRole('link').click();
    await expect(page).toHaveURL(/\/admin\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByText('Checking payment')).toBeVisible();
    await page.getByRole('button', { name: /^approve — ৳2,400\.00$/i }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('৳2,400.00');
    await expect(dialog).toContainText('buyer@example.com');
    await dialog.getByRole('button', { name: /approve and issue tickets/i }).click();

    await expect(page.getByRole('status')).toContainText(/2 tickets issued/);
    await expect(page.getByTestId('order-status')).toHaveText('Tickets issued');
    const ticketRows = page.getByTestId('ticket-row');
    await expect(ticketRows).toHaveCount(2);
    await expect(ticketRows.first()).toContainText(/TKT-[A-Z2-9]{8}/);
    await expect(ticketRows.first()).toContainText('Nusrat Jahan 1');
    // No Approve/Reject once issued; the audit trail tells the story.
    await expect(page.getByRole('button', { name: /^approve/i })).toHaveCount(0);
    await expect(page.getByText('tickets.issued')).toBeVisible();
    await expect(page.getByText('payment.approved')).toBeVisible();

    // The buyer's page: "You're in." with the same ticket codes.
    await page.goto(a.url);
    await expect(page.getByRole('heading', { name: /you're in/i })).toBeVisible();
    await expect(page.getByTestId('ticket-list').getByRole('listitem')).toHaveCount(2);

    // Inventory: 2 sold (no longer held), 1 still held by B → 17 left.
    await page.goto(`/events/${slug}`);
    await expect(page.locator('li:visible').filter({ hasText: 'General' }).first()).toContainText(
      '17 left',
    );

    // B8: reject B with a reason and a note.
    await page.goto('/admin/verification');
    await page.getByTestId('queue-row').filter({ hasText: b.reference }).getByRole('link').click();
    await page.getByRole('button', { name: /^reject$/i }).click();
    const reject = page.getByRole('dialog');
    await reject.getByLabel(/reason/i).selectOption('amount_mismatch');
    await reject
      .getByLabel(/note to the buyer/i)
      .fill('You sent ৳1,000.00; the order is ৳1,200.00.');
    await reject.getByRole('button', { name: /reject order/i }).click();

    await expect(page.getByRole('status')).toContainText(/order rejected/i);
    await expect(page.getByText('payment.rejected')).toBeVisible();

    // Buyer sees the reason and the note word for word; the seat is back on sale.
    await page.goto(b.url);
    await expect(page.getByTestId('rejection-reason')).toHaveText(
      'The amount sent does not match the order total',
    );
    await expect(page.getByTestId('rejection-note')).toHaveText(
      'You sent ৳1,000.00; the order is ৳1,200.00.',
    );
    await page.goto(`/events/${slug}`);
    await expect(page.locator('li:visible').filter({ hasText: 'General' }).first()).toContainText(
      '18 left',
    );

    // Queue is clear of both.
    await page.goto('/admin/verification');
    await expect(page.getByTestId('queue-row').filter({ hasText: a.reference })).toHaveCount(0);
    await expect(page.getByTestId('queue-row').filter({ hasText: b.reference })).toHaveCount(0);
  });
});
