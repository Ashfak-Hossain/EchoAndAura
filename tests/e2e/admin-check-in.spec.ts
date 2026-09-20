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
  // Draft: no door list button yet, but the page itself answers honestly.
  await expect(page.getByRole('link', { name: 'Check-in list' })).toHaveCount(0);
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

/** Registers `quantity` tickets, submits a trxID and approves the order on B8. */
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
  const trxId = `CI${Date.now().toString(36).toUpperCase()}`.slice(0, 10).padEnd(10, 'Z');
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
  return { reference, codes: codes.map((t) => t.match(/TKT-[A-Z2-9]{8}/)![0]) };
}

test.describe('check-in list (B11)', () => {
  test('lists issued tickets, searches, sorts, prints and exports', async ({ page }) => {
    test.slow();
    await signIn(page);
    const { id, slug } = await publishedEvent(page, `Check-in ${Date.now()}`);
    const checkInUrl = `/admin/events/${id}/check-in`;

    // Published, nothing sold: the button exists and the page says so.
    await page.goto(`/admin/events/${id}/edit`);
    await page.getByRole('link', { name: 'Check-in list' }).click();
    await expect(page).toHaveURL(checkInUrl);
    await expect(page.getByText('No tickets issued yet').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /print list/i })).toBeDisabled();

    const { reference, codes } = await issuedOrder(page, slug, 'Nusrat Jahan', 2);
    expect(codes).toHaveLength(2);

    // Two names, A–Z, with type, code and order.
    await page.goto(checkInUrl);
    const rows = page.getByTestId('check-in-row');
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId('check-in-count')).toHaveText('2 names');
    await expect(rows.first()).toContainText('Nusrat Jahan');
    await expect(rows.first()).toContainText('General');
    await expect(rows.first()).toContainText(reference);
    await expect(page.getByRole('columnheader', { name: /^Attendee/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );

    // Search: a lower-case code without its prefix finds one; the reference finds both.
    const searchbox = page.getByRole('searchbox', { name: 'Search' }).first();
    await searchbox.fill(codes[1]!.slice(4).toLowerCase());
    await searchbox.press('Enter');
    await expect(page).toHaveURL(/\?q=/);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(codes[1]!);
    await expect(page.getByTestId('check-in-count')).toHaveText('2 names');
    // A filtered list is never printed from the button, and ⌘P labels itself.
    await expect(page.getByRole('button', { name: /print list/i })).toBeDisabled();
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('check-in-print-sheet')).toContainText('Partial list');
    await expect(page.getByTestId('check-in-print-sheet')).toContainText('1 of 2 names');
    await page.emulateMedia({ media: 'screen' });

    await searchbox.fill(reference.toLowerCase());
    await searchbox.press('Enter');
    await expect(rows).toHaveCount(2);

    await searchbox.fill('nobody at all');
    await searchbox.press('Enter');
    await expect(page.getByText(/No names match “nobody at all”/).first()).toBeVisible();
    await page.getByRole('link', { name: 'Clear search' }).first().click();
    await expect(page).toHaveURL(checkInUrl);
    // The box follows the URL after an outside clear.
    await expect(searchbox).toHaveValue('');

    // The toolbar's own Clear cancels a term still in its debounce window.
    await searchbox.fill('tan');
    await expect(page).toHaveURL(/\?q=tan/, { timeout: 5_000 });
    await searchbox.fill('tanv');
    await page.getByRole('button', { name: 'Clear' }).first().click();
    await expect(page).toHaveURL(checkInUrl);
    await page.waitForTimeout(600);
    await expect(page).toHaveURL(checkInUrl);
    await expect(rows).toHaveCount(2);

    // Sorting is a link on the header.
    await page.getByRole('link', { name: /^Ticket code/ }).click();
    await expect(page).toHaveURL(/sort=code%3Aasc/);
    await expect(page.getByRole('columnheader', { name: /^Ticket code/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    const sortedCodes = [...codes].sort();
    await expect(rows.first()).toContainText(sortedCodes[0]!);

    // Print: the sheet appears, the chrome goes. Sorted by code on screen,
    // the sheet is still name A–Z (both tickets carry the buyer's name here,
    // so the code tiebreak decides: ascending either way).
    const sheet = page.getByTestId('check-in-print-sheet');
    await expect(sheet).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Check-in list');
    await expect(sheet).toContainText('2 names · as of');
    await expect(sheet).not.toContainText('Partial list');
    await expect(sheet).toContainText('Cancelled tickets are not printed');
    await expect(sheet.getByRole('row')).toHaveCount(3);
    await expect(sheet.getByRole('row').nth(1)).toContainText(sortedCodes[0]!);
    await expect(page.getByRole('navigation', { name: 'Admin' })).toBeHidden();
    await expect(page.getByRole('button', { name: /print list/i })).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await expect(sheet).toBeHidden();

    // CSV honours the search and is a real CSV with a blank tick column.
    const csv = await page.request.get(`${checkInUrl}/export.csv?q=${codes[0]}&sort=code:desc`);
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(csv.headers()['content-disposition']).toMatch(
      new RegExp(`check-in-${slug}-\\d{8}-\\d{4}\\.csv`),
    );
    const text = await csv.text();
    expect(
      text.startsWith('\uFEFFattendee_name,ticket_type,ticket_code,order_reference,checked_in'),
    ).toBe(true);
    const lines = text.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(`Nusrat Jahan,General,${codes[0]},${reference},`);
    const all = await (await page.request.get(`${checkInUrl}/export.csv`)).text();
    expect(all.split('\r\n').filter(Boolean)).toHaveLength(3);

    // Unknown ids are 404s, not errors.
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await page.goto('/admin/events/not-a-uuid/check-in'))?.status()).toBe(404);
    expect((await page.goto(`/admin/events/${missing}/check-in`))?.status()).toBe(404);
    expect((await page.request.get(`/admin/events/${missing}/check-in/export.csv`)).status()).toBe(
      404,
    );
  });

  test('a signed-out visitor cannot export the check-in list', async ({ page }) => {
    const res = await page.request.get(
      '/admin/events/00000000-0000-4000-8000-000000000000/check-in/export.csv',
      { maxRedirects: 0 },
    );
    expect([302, 303, 307, 308]).toContain(res.status());
  });
});
