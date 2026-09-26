import path from 'node:path';
import { formatInTimeZone } from 'date-fns-tz';
import { expect, type Page } from '@playwright/test';

/**
 * Shared by the gate-scanner specs (ADR-030 online, ADR-034 offline).
 */

// Requires a seeded admin (pnpm admin:create) and MinIO (docker compose).
const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'correct-horse-battery';
const COVER = path.join(__dirname, 'fixtures', 'cover.png');
export const dhaka = (at: Date) => formatInTimeZone(at, 'Asia/Dhaka', "yyyy-MM-dd'T'HH:mm");

export async function signIn(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
}

export async function openTab(
  page: Page,
  name: 'Details' | 'Cover image' | 'Ticket types' | 'Publish',
) {
  await page
    .getByRole('navigation', { name: /event sections/i })
    .getByRole('link', { name })
    .click();
}

/** A published event in 2030 with General (৳1,200 × 20). Returns { id, slug }. */
export async function publishedEvent(page: Page, title: string) {
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

/** Registers `quantity` tickets, submits a trxID and approves on B8 (ends there). */
export async function issuedOrder(page: Page, slug: string, name: string, quantity: number) {
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
  const trxId = `DR${Date.now().toString(36).toUpperCase()}`.slice(0, 10).padEnd(10, 'Z');
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
  return { orderUrl: page.url(), codes: codes.map((t) => t.match(/TKT-[A-Z2-9]{8}/)![0]) };
}

/** Admin: a new gate pass on the check-in page; returns its code as shown. */
export async function newGatePass(page: Page, checkInUrl: string, label: string) {
  await page.goto(checkInUrl);
  const card = page.getByTestId('gate-passes');
  await card.getByLabel('Gate name').fill(label);
  await card.getByRole('button', { name: 'New gate pass' }).click();
  await expect(page).toHaveURL(/\?pass=[0-9a-f-]{36}/);
  const row = card.getByTestId('gate-pass-row').filter({ hasText: label });
  // The pass just made opens by itself: QR + code.
  const code = (await row.getByTestId('gate-pass-code').textContent())!;
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  return code;
}

/** Door phone: type a code, return the full-screen answer. */
export async function typeCode(door: Page, code: string) {
  const field = door.getByLabel('Ticket code');
  if (!(await field.isVisible())) await door.getByRole('button', { name: 'Type a code' }).click();
  await field.fill(code.toLowerCase());
  await door.getByRole('button', { name: 'Check' }).click();
  const result = door.getByTestId('door-result');
  await expect(result).toBeVisible();
  return result;
}

export async function dismiss(door: Page) {
  const result = door.getByTestId('door-result');
  if ((await result.getAttribute('data-tone')) !== 'green') {
    await result.getByRole('button', { name: 'Next' }).click();
  }
  await expect(result).toBeHidden();
}

/** The organizer moves the start to an hour ago: doors are open. */
export async function openDoors(page: Page, id: string) {
  await page.goto(`/admin/events/${id}/edit`);
  await page.getByLabel(/^Starts at/).fill(dhaka(new Date(Date.now() - 60 * 60_000)));
  await page.getByLabel(/^Registration closes/).fill(dhaka(new Date(Date.now() - 2 * 60 * 60_000)));
  await page.getByRole('button', { name: /save changes/i }).click();
  await expect(page).toHaveURL(/\?saved=1/);
}
