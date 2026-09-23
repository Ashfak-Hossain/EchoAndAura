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
  await page.getByLabel('Venue', { exact: true }).fill('ICCB Hall 4, Dhaka');
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

test.describe('complimentary tickets (B13)', () => {
  test('issue from the Ticket types tab → B8 → B9 → report → cancel one', async ({ page }) => {
    test.slow();
    await signIn(page);
    const title = `Comps ${Date.now()}`;
    const { id } = await publishedEvent(page, title);

    // The row's "Issue comps" opens the sheet over the tab, type preselected.
    await page.goto(`/admin/events/${id}/edit?tab=ticket-types`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: 'Issue comps: General' }).click();
    await expect(page).toHaveURL(/comp=[0-9a-f-]{36}/);
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Issue complimentary tickets')).toBeVisible();
    await expect(sheet.getByText(/Comps take real stock/)).toBeVisible();
    await expect(sheet.getByLabel('Ticket type')).toHaveValue(/[0-9a-f-]{36}/);
    await page.waitForLoadState('networkidle');

    // Missing reason: refused inline, everything typed is kept.
    await sheet.getByRole('button', { name: 'More tickets' }).click();
    await sheet.getByLabel('Name on the tickets').fill('Tahmina Akter');
    await sheet.getByLabel('Email', { exact: true }).fill('tahmina@dhakapress.com');
    await sheet.getByRole('button', { name: 'Issue 2 General tickets' }).click();
    await expect(sheet.getByText('Say why — it goes in the audit trail.')).toBeVisible();
    await expect(sheet.getByLabel('Name on the tickets')).toHaveValue('Tahmina Akter');
    await expect(sheet.getByLabel('How many')).toHaveValue('2');

    await sheet.getByLabel(/^Reason/).fill('Press — Dhaka Press review');
    await sheet.getByRole('button', { name: 'Issue 2 General tickets' }).click();
    await expect(page).toHaveURL(/comped=[0-9a-f-]{36}/, { timeout: 20_000 });
    await expect(page.getByTestId('comp-issued')).toBeVisible();
    // Stock moved on the editor's own table: 2 sold, 18 available.
    await expect(page.getByText(/2 sold · 0 held · 18 available/)).toBeVisible();

    // B8: born issued, ৳0.00, the reason for the admin only, two tickets.
    await page.getByTestId('comp-issued').getByRole('link', { name: 'View order' }).click();
    await expect(page).toHaveURL(/\/admin\/orders\/[0-9a-f-]{36}$/);
    const orderUrl = page.url();
    await expect(page.getByTestId('order-status')).toHaveText('Tickets issued');
    await expect(page.getByTestId('order-comp')).toHaveText('Complimentary');
    await expect(page.getByTestId('comp-card')).toContainText('Press — Dhaka Press review');
    await expect(page.getByTestId('comp-card')).toContainText(`Issued by ${email}`);
    await expect(page.getByTestId('ticket-row')).toHaveCount(2);
    await expect(page.getByTestId('ticket-row').first()).toContainText('Tahmina Akter');
    await expect(page.getByText('order.comp_issued')).toBeVisible();

    // A4, as the guest would reach it: complimentary, never "paid", no reason.
    const orderId = orderUrl.split('/').at(-1)!;
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByTestId('issued-line')).toContainText('Complimentary tickets from');
    await expect(page.getByTestId('ticket-list').getByRole('listitem')).toHaveCount(2);
    await expect(page.getByText(/Payment confirmed|Paid ·/)).toHaveCount(0);
    await expect(page.getByText('Dhaka Press review')).toHaveCount(0);

    // B9: the row says Comp at ৳0.00, and the revenue tile counts no paid order.
    await page.goto(`/admin/orders?event=${id}`);
    await expect(page.getByRole('row', { name: /Tahmina Akter/ })).toContainText('Comp');
    await expect(page.getByRole('row', { name: /Tahmina Akter/ })).toContainText('৳0.00');
    await expect(page.getByTestId('revenue-tile')).toContainText('0 paid orders · 1 comp');

    // B12: seats, not sales.
    await page.goto(`/admin/reports?event=${id}`);
    await expect(page.getByTestId('kpi-sold')).toHaveText('2');
    await expect(page.getByTestId('kpi-comp')).toHaveText('2');
    await expect(page.getByTestId('kpi-left')).toHaveText('18');
    await expect(page.getByTestId('kpi-row')).toContainText('verified only · 0 orders');
    await expect(page.getByTestId('ticket-type-comp')).toHaveText('2');
    await expect(page.getByTestId('ticket-type-notes')).toContainText(
      '2 complimentary tickets are counted as sold at ৳0.00',
    );
    await expect(page.getByTestId('ticket-type-notes')).not.toContainText('Discounts of');
    // Comps alone are not sales: the empty state stays, the lines name the comps.
    await expect(page.getByText('No sales to report yet')).toBeVisible();

    // Cancel one, as for any issued ticket: a seat comes back.
    await page.goto(orderUrl);
    await page.getByTestId('ticket-row').nth(0).getByRole('button', { name: 'Cancel' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Reason/).fill('Guest cannot come');
    await dialog.getByRole('button', { name: 'Cancel ticket' }).click();
    await expect(page.getByText('1 issued · 1 cancelled')).toBeVisible();
    await page.goto(`/admin/reports?event=${id}`);
    await expect(page.getByTestId('kpi-comp')).toHaveText('1');
    await expect(page.getByTestId('kpi-left')).toHaveText('19');
  });

  test('a signed-out visitor cannot open the sheet', async ({ page }) => {
    const res = await page.request.get(
      '/admin/events/00000000-0000-4000-8000-000000000000/edit?tab=ticket-types&comp=1',
      { maxRedirects: 0 },
    );
    expect([302, 303, 307, 308]).toContain(res.status());
  });
});
