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

const stamp = () => Date.now().toString(36).toUpperCase().slice(-6);

test.describe('orders list (B9)', () => {
  test('search by reference, phone, email and trxID; status filter; no-results; CSV export', async ({
    page,
  }) => {
    test.slow();
    await signIn(page);
    const slug = await publishedEvent(page, `Orders ${Date.now()}`);

    // One order, then its trxID submitted.
    const buyerEmail = `orders-${Date.now()}@example.com`;
    await page.goto(`/events/${slug}/register`);
    await page.getByRole('radio', { name: /general/i }).check();
    await page.getByLabel('Full name').fill('Nusrat Jahan');
    await page.getByLabel('Email address').fill(buyerEmail);
    await page.getByLabel('Mobile number').fill('1799887766');
    await page.getByLabel(/I agree to the terms/).check();
    await page.getByRole('button', { name: /continue to payment/i }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    const reference = (await page.getByTestId('order-reference').textContent())!;
    const trxId = `ORD${stamp()}X`.slice(0, 10).padEnd(10, 'Z');
    await page.getByLabel(/transaction id \(trxid\)/i).fill(trxId);
    await page.getByLabel('Number you sent from').fill('1799887766');
    await page.getByRole('button', { name: /i have sent the money/i }).click();
    await expect(page.getByText('Checking payment')).toBeVisible();

    // Nav item is live.
    await page.goto('/admin');
    await page
      .getByRole('navigation', { name: 'Admin' })
      .getByRole('link', { name: 'Orders' })
      .click();
    await expect(page).toHaveURL(/\/admin\/orders$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Orders' }).last()).toBeVisible();

    const rows = page.getByTestId('order-row');
    // Desktop toolbar (the phone one is hidden at this viewport).
    const searchbox = page.getByRole('searchbox', { name: 'Search' }).first();
    const status = page.getByLabel('Status').first();
    const search = async (q: string) => {
      await searchbox.fill(q);
      await searchbox.press('Enter');
      await expect(page).toHaveURL(
        new RegExp(`q=${encodeURIComponent(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      );
    };

    await search(reference.toLowerCase());
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(reference);
    await expect(page.getByText(/1 order match for “/)).toBeVisible();
    await expect(page.getByTestId('table-range')).toHaveText('1–1 of 1');

    // Typing alone (no Enter) reaches the URL after the debounce.
    await searchbox.fill('01799887766');
    await expect(page).toHaveURL(/q=01799887766/, { timeout: 5_000 });
    await expect(rows.filter({ hasText: reference })).toHaveCount(1);

    await search(buyerEmail.toUpperCase());
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(buyerEmail);

    await search(trxId.toLowerCase());
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(trxId);

    // Status filter narrows; the wrong status hides it. Selects apply on change.
    await page.goto('/admin/orders');
    await status.selectOption('pending_verification');
    await expect(page).toHaveURL(/status=pending_verification/);
    await expect(rows.filter({ hasText: reference })).toHaveCount(1);
    await status.selectOption('issued');
    await expect(page).toHaveURL(/status=issued/);
    await expect(rows.filter({ hasText: reference })).toHaveCount(0);

    // Status tiles double as the filter: click narrows, the active tile clears.
    await page.goto('/admin/orders');
    await page.getByTestId('status-tile-pending_verification').click();
    await expect(page).toHaveURL(/status=pending_verification/);
    await expect(rows.filter({ hasText: reference })).toHaveCount(1);
    await expect(page.getByTestId('status-tile-pending_verification')).toHaveAttribute(
      'aria-current',
      'true',
    );
    await page.getByTestId('status-tile-pending_verification').click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(page.getByTestId('revenue-tile')).toContainText('৳');

    // Sorting is a link on the header; the arrow marks the active column.
    await page.getByRole('link', { name: /^Total/ }).click();
    await expect(page).toHaveURL(/sort=total%3Adesc/);
    await expect(page.getByRole('columnheader', { name: /^Total/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    await page.getByRole('link', { name: /^Total/ }).click();
    await expect(page).toHaveURL(/sort=total%3Aasc/);

    // Column visibility is remembered per browser.
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByTestId('column-toggle-trxId').click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('columnheader', { name: 'trxID' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('columnheader', { name: 'trxID' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByTestId('column-toggle-trxId').click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('columnheader', { name: 'trxID' })).toHaveCount(1);

    // No results state.
    await page.goto('/admin/orders');
    await search('01999888777');
    // The empty state renders once for the desktop table and once for the phone list.
    await expect(page.getByText(/No orders match “01999888777”/).first()).toBeVisible();
    await page.getByRole('link', { name: 'Clear filters' }).first().click();
    await expect(page).toHaveURL(/\/admin\/orders$/);

    // CSV export respects the filters and is a real CSV.
    const csv = await page.request.get(
      `/admin/orders/export.csv?q=${encodeURIComponent(reference)}`,
    );
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(csv.headers()['content-disposition']).toMatch(/orders-\d{8}-\d{4}\.csv/);
    const text = await csv.text();
    expect(text.startsWith('﻿reference,status,event')).toBe(true);
    expect(text).toContain(reference);
    expect(text).toContain('1200.00');
    expect(text).toContain(trxId);
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(2);
  });

  test('a buyer session cannot export orders', async ({ page }) => {
    const res = await page.request.get('/admin/orders/export.csv', { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(res.status());
  });
});
