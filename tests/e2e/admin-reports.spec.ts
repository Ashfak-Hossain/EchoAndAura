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
  const trxId = `RP${Date.now().toString(36).toUpperCase()}`.slice(0, 10).padEnd(10, 'Z');
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
  return { reference, orderUrl: page.url().replace(/\?.*$/, '') };
}

test.describe('sales report (B12)', () => {
  test('empty state → first verified sale → cancel → CSVs; every figure agrees with B9', async ({
    page,
  }) => {
    test.slow();
    await signIn(page);
    const title = `Report ${Date.now()}`;
    const { id, slug } = await publishedEvent(page, title);
    const reportUrl = `/admin/reports?event=${id}`;

    // Nav is live and the fresh event reads as "no sales yet" with honest zeros.
    await page.goto('/admin');
    await page
      .getByRole('navigation', { name: 'Admin' })
      .getByRole('link', { name: 'Reports' })
      .click();
    await expect(page).toHaveURL(/\/admin\/reports/, { timeout: 20_000 });
    await page.goto(reportUrl);
    await expect(page.getByTestId('report-subtitle')).toContainText(title);
    await expect(page.getByText('No sales to report yet')).toBeVisible();
    await expect(page.getByText(/Registration opened .* \(Dhaka\)/)).toBeVisible();
    await expect(page.getByTestId('kpi-sold')).toHaveText('0');
    await expect(page.getByTestId('kpi-left')).toHaveText('20');
    await expect(page.getByTestId('kpi-row')).toContainText('Nothing waiting');
    await expect(page.getByTestId('ticket-type-row')).toHaveCount(1);
    await expect(page.getByTestId('sales-over-time')).toHaveCount(0);
    await expect(
      page.getByTestId('events-overview').locator('[aria-current="true"]'),
    ).toContainText(title);

    // One verified order of two tickets.
    const { orderUrl } = await issuedOrder(page, slug, 'Nusrat Jahan', 2);
    await page.goto(reportUrl);
    await expect(page.getByText('No sales to report yet')).toHaveCount(0);
    await expect(page.getByTestId('kpi-sold')).toHaveText('2');
    await expect(page.getByTestId('kpi-row')).toContainText('of 20 · 10%');
    await expect(page.getByTestId('kpi-row')).toContainText('৳2,400.00');
    await expect(page.getByTestId('kpi-row')).toContainText('verified only · 1 order');
    await expect(page.getByTestId('kpi-left')).toHaveText('18');
    // Today's bar is the marigold one and carries the sale.
    const today = page.getByTestId('bar-today');
    await expect(today).toHaveAttribute('data-tickets', '2');
    await expect(today).toHaveAttribute('fill', '#eda43c');
    // Hovering a bar answers with the day's numbers.
    await today.hover();
    await expect(page.getByTestId('sales-over-time')).toContainText('2 tickets৳2,400.00');
    await expect(page.getByTestId('sales-over-time')).toContainText(
      /Peak was .* — 2 tickets, ৳2,400\.00/,
    );
    await expect(page.getByTestId('funnel')).toContainText('100% of placed');
    await expect(page.getByTestId('speed')).toContainText('2 tickets in 1 verified order');
    const general = page.getByTestId('ticket-type-row');
    await expect(general).toContainText('General');
    await expect(general).toContainText('৳2,400.00');
    await expect(page.getByTestId('ticket-type-total')).toContainText('৳2,400.00');
    await expect(page.getByTestId('when-people-register')).toContainText('1 order placed');

    // The range control writes the URL; "All time" runs from registration opening.
    await page.getByRole('radio', { name: 'All time' }).click();
    await expect(page).toHaveURL(/range=all/);
    await expect(page.getByTestId('sales-over-time')).toContainText('Thu 1 Jan');
    await expect(page.getByRole('radio', { name: 'All time' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Cancel one ticket: a seat comes back, the money stays counted (ADR-024).
    await page.goto(orderUrl);
    await page.getByTestId('ticket-row').nth(0).getByRole('button', { name: 'Cancel' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Reason/).fill('Buyer asked; refunded by bKash');
    await dialog.getByRole('button', { name: 'Cancel ticket' }).click();
    await expect(page.getByText('1 issued · 1 cancelled')).toBeVisible();
    await page.goto(reportUrl);
    await expect(page.getByTestId('kpi-sold')).toHaveText('1');
    await expect(page.getByTestId('kpi-left')).toHaveText('19');
    await expect(page.getByTestId('kpi-row')).toContainText('৳2,400.00');
    await expect(page.getByTestId('ticket-type-notes')).toContainText(
      '1 cancelled ticket is not counted as sold',
    );
    await expect(page.getByTestId('funnel')).toContainText('1 seat back on sale');
    // Gross vs net, side by side and labelled: 2 verified, 1 seat sold now.
    await expect(page.getByTestId('sales-over-time')).toContainText(
      '2 tickets verified by today · 1 seat sold now, after cancellations',
    );

    // B9 agrees: the Revenue tile for this event shows the same money.
    await page.goto(`/admin/orders?event=${id}`);
    await expect(page.getByTestId('revenue-tile')).toContainText('৳2,400.00');

    // Three CSVs from the same report.
    const summary = await page.request.get(`/admin/reports/export.csv?event=${id}&section=summary`);
    expect(summary.status()).toBe(200);
    expect(summary.headers()['content-disposition']).toContain(`sales-${slug}-summary-`);
    const summaryLines = (await summary.text()).replace(/^﻿/, '').trim().split('\r\n');
    expect(summaryLines[0]).toBe(
      'ticket_type,unit_price_bdt,seats,sold,held,available,verified_orders,revenue_bdt,discounts_bdt,complimentary',
    );
    expect(summaryLines[1]).toBe('General,1200.00,20,1,0,19,1,2400.00,0.00,0');
    expect(summaryLines[2]).toBe('Total,,20,1,0,19,1,2400.00,0.00,0');

    const daily = await page.request.get(
      `/admin/reports/export.csv?event=${id}&section=daily&range=14`,
    );
    const dailyLines = (await daily.text()).replace(/^﻿/, '').trim().split('\r\n');
    expect(dailyLines).toHaveLength(15);
    expect(dailyLines[0]).toBe('date,orders,tickets_verified,revenue_bdt,tickets_verified_to_date');
    expect(dailyLines.at(-1)).toMatch(/^\d{4}-\d{2}-\d{2},1,2,2400\.00,2$/);

    const overview = await page.request.get(
      `/admin/reports/export.csv?event=${id}&section=overview`,
    );
    const overviewText = await overview.text();
    expect(overviewText).toContain(
      'event,status,starts_dhaka,seats,sold,held,revenue_bdt,verified_orders,pending_bdt,pending_orders',
    );
    expect(overviewText).toContain(`${title},Published,2030-10-01 19:00,20,1,0,2400.00,1,0.00,0`);

    // An unknown event id is a 404, on the page and the export alike.
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await page.request.get(`/admin/reports/export.csv?event=${missing}`)).status()).toBe(
      404,
    );
    expect((await page.goto(`/admin/reports?event=${missing}`))?.status()).toBe(404);
  });

  test('a signed-out visitor is sent to the login page, and cannot export', async ({ page }) => {
    for (const url of ['/admin/reports', '/admin/reports/export.csv']) {
      const res = await page.request.get(url, { maxRedirects: 0 });
      expect([302, 303, 307, 308]).toContain(res.status());
    }
  });
});
