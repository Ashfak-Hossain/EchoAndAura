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
    const search = async (q: string) => {
      await page.getByRole('searchbox', { name: 'Search' }).fill(q);
      await page.getByRole('button', { name: 'Apply' }).click();
      await expect(page).toHaveURL(
        new RegExp(`q=${encodeURIComponent(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      );
    };

    await search(reference.toLowerCase());
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(reference);
    await expect(page.getByTestId('orders-summary')).toContainText('Showing 1 result');

    await search('01799887766');
    await expect(rows.filter({ hasText: reference })).toHaveCount(1);

    await search(buyerEmail.toUpperCase());
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(buyerEmail);

    await search(trxId.toLowerCase());
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(trxId);

    // Status filter narrows; the wrong status hides it.
    await page.getByRole('searchbox', { name: 'Search' }).fill('');
    await page.getByLabel('Status').selectOption('pending_verification');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(rows.filter({ hasText: reference })).toHaveCount(1);
    await page.getByLabel('Status').selectOption('issued');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(rows.filter({ hasText: reference })).toHaveCount(0);

    // No results state.
    await page.getByLabel('Status').selectOption('');
    await search('01999888777');
    await expect(page.getByText(/No orders match “01999888777”/)).toBeVisible();
    await page.getByRole('link', { name: 'Clear filters' }).click();
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
