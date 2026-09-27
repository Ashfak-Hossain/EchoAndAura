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

/** A published event with General (৳1,200 × 50) and Last One (৳500 × 1). Returns its slug. */
async function publishedEvent(page: Page, title: string): Promise<string> {
  await page.goto('/admin/events/new');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Venue', { exact: true }).fill('ICCB Hall 4, Dhaka');
  await page.getByLabel(/^Starts at/).fill('2030-10-01T19:00');
  await page.getByLabel(/^Registration opens/).fill('2026-01-01T10:00');
  await page.getByRole('button', { name: /create event/i }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/edit$/);
  const slug = await page.getByLabel(/^URL slug/).inputValue();

  for (const [name, price, qty] of [
    ['General', '1200', '50'],
    ['Last One', '500', '1'],
  ]) {
    await openTab(page, 'Ticket types');
    await page
      .getByRole('link', { name: /add ticket type/i })
      .first()
      .click();
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel(/^Price/).fill(price);
    await page.getByLabel('Quantity', { exact: true }).fill(qty);
    await page.getByRole('button', { name: /add ticket type/i }).click();
    await expect(page).toHaveURL(/tab=ticket-types$/);
  }
  await openTab(page, 'Cover image');
  await page.getByTestId('cover-file').setInputFiles(COVER);
  await expect(page.getByTestId('cover-image')).toBeVisible();
  await openTab(page, 'Publish');
  await page.getByRole('button', { name: /^publish$/i }).click();
  await expect(page.getByTestId('event-status')).toHaveText('published');
  return slug;
}

test.describe('registration (A3 → A4)', () => {
  test('a buyer registers two General tickets and lands on the awaiting-payment page', async ({
    page,
  }) => {
    await signIn(page);
    const slug = await publishedEvent(page, `Register ${Date.now()}`);

    await page.goto(`/events/${slug}/register`);
    await page.getByRole('radio', { name: /general/i }).check();
    await page.getByRole('button', { name: /more tickets/i }).click();
    await expect(page.getByLabel('Number of tickets')).toHaveValue('2');
    await expect(page.getByTestId('summary-total')).toHaveText('৳2,400.00');

    // "I agree to the terms" points at the real terms page (A7).
    await expect(page.getByRole('link', { name: 'terms', exact: true })).toHaveAttribute(
      'href',
      '/terms',
    );
    await page.getByLabel('Full name').fill('Nusrat Jahan');
    await page.getByLabel('Email address').fill('Nusrat.Jahan@example.com');
    await page.getByLabel('Mobile number').fill('1712345678');
    await page.getByLabel(/I agree to the terms/).check();
    await page.getByRole('button', { name: /continue to payment/i }).click();

    // A4, awaiting payment, with the server-computed total.
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('order-reference')).toHaveText(/^EA-[A-Z2-9]{6}$/);
    await expect(page.getByText('Awaiting payment')).toBeVisible();
    await expect(page.getByText('৳2,400.00').first()).toBeVisible();
    await expect(page.getByText('2 × General')).toBeVisible();
    await expect(page.getByRole('heading', { name: /how to pay with bkash/i })).toBeVisible();
    // Not for search engines.
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', /noindex/);

    // The hold is visible on the public event page: 48 General left.
    await page.goto(`/events/${slug}`);
    await expect(page.locator('li:visible').filter({ hasText: 'General' }).first()).toContainText(
      '48 left',
    );
  });

  test('validation errors are listed and nothing the buyer typed is cleared', async ({ page }) => {
    await signIn(page);
    const slug = await publishedEvent(page, `Register Errors ${Date.now()}`);

    await page.goto(`/events/${slug}/register`);
    await page.getByLabel('Full name').fill('Nusrat Jahan');
    await page.getByLabel('Email address').fill('nusrat.jahan@');
    await page.getByLabel('Mobile number').fill('17123');
    await page.getByRole('button', { name: /continue to payment/i }).click();

    const summary = page.getByRole('alert').first();
    await expect(summary).toContainText(/things need fixing/i);
    await expect(summary).toContainText('Enter a complete email address.');
    await expect(summary).toContainText('A bKash number is 10 digits after +880.');
    await expect(summary).toContainText('Accept the terms to continue.');
    // Nothing cleared.
    await expect(page.getByLabel('Full name')).toHaveValue('Nusrat Jahan');
    await expect(page.getByLabel('Email address')).toHaveValue('nusrat.jahan@');
    await expect(page.getByLabel('Mobile number')).toHaveValue('17123');
    await expect(page).toHaveURL(/\/register$/);
  });

  test('the stepper never exceeds stock, and a second buyer of the last ticket is told it sold out', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const slug = await publishedEvent(page, `Register Race ${Date.now()}`);

    await page.goto(`/events/${slug}/register`);
    await page.getByRole('radio', { name: /last one/i }).check();
    await expect(page.getByRole('button', { name: /more tickets/i })).toBeDisabled();
    await expect(page.getByText('Only 1 left')).toBeVisible();

    // A second buyer opens the same form before the first submits.
    const other = await browser.newPage();
    await other.goto(`/events/${slug}/register`);
    await other.getByRole('radio', { name: /last one/i }).check();

    const fill = async (p: Page, name: string) => {
      await p.getByLabel('Full name').fill(name);
      await p.getByLabel('Email address').fill('buyer@example.com');
      await p.getByLabel('Mobile number').fill('1712345678');
      await p.getByLabel(/I agree to the terms/).check();
      await p.getByRole('button', { name: /continue to payment/i }).click();
    };

    await fill(page, 'First Buyer');
    await expect(page).toHaveURL(/\/orders\//);

    await fill(other, 'Second Buyer');
    await expect(other.getByRole('alert').first()).toContainText(
      /sold out while you were choosing/i,
    );
    await expect(other).toHaveURL(/\/register$/);
    // Their input survived, and the sold-out row is now disabled.
    await expect(other.getByLabel('Full name')).toHaveValue('Second Buyer');
    await expect(other.getByRole('radio', { name: /last one/i })).toBeDisabled();
    await other.close();
  });

  test('the buyer submits a trxID, can correct it, and the same trxID cannot pay twice', async ({
    page,
  }) => {
    await signIn(page);
    const slug = await publishedEvent(page, `Payment ${Date.now()}`);
    const trxId = `T${Date.now().toString(36).toUpperCase().slice(-9)}`.padEnd(10, 'X');

    const register = async (name: string) => {
      await page.goto(`/events/${slug}/register`);
      await page.getByRole('radio', { name: /general/i }).check();
      await page.getByLabel('Full name').fill(name);
      await page.getByLabel('Email address').fill('buyer@example.com');
      await page.getByLabel('Mobile number').fill('1712345678');
      await page.getByLabel(/I agree to the terms/).check();
      await page.getByRole('button', { name: /continue to payment/i }).click();
      await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
      return page.url();
    };

    const first = await register('Nusrat Jahan');

    // Format is checked before anything is saved.
    await page.getByLabel(/transaction id \(trxid\)/i).fill('9AB12CD');
    await page.getByLabel('Number you sent from').fill('1712345678');
    await page.getByRole('button', { name: /i have sent the money/i }).click();
    await expect(
      page.getByText(/exactly 10 letters and numbers — you have entered 7/),
    ).toBeVisible();
    await expect(page.getByText('Awaiting payment')).toBeVisible();

    // A real one: "Checking payment", with what was submitted.
    await page.getByLabel(/transaction id \(trxid\)/i).fill(trxId.toLowerCase());
    await page.getByRole('button', { name: /i have sent the money/i }).click();
    await expect(page.getByText('Checking payment')).toBeVisible();
    await expect(page.getByRole('heading', { name: /checking your payment/i })).toBeVisible();
    const summary = page.getByTestId('payment-summary');
    await expect(summary).toContainText(trxId); // upper-cased by the server
    await expect(summary).toContainText('+880 1712345678');
    await expect(summary).toContainText('৳1,200.00');
    await expect(page.getByLabel(/transaction id \(trxid\)/i)).toHaveCount(0);

    // Edit keeps the status and replaces the id.
    await page.getByRole('button', { name: /edit transaction id/i }).click();
    const edited = `${trxId.slice(0, 9)}9`;
    await page.getByLabel(/transaction id \(trxid\)/i).fill(edited);
    await page.getByRole('button', { name: /save transaction id/i }).click();
    await expect(page.getByTestId('payment-summary')).toContainText(edited);
    await expect(page.getByText('Checking payment')).toBeVisible();

    // A second order cannot reuse it — the database says no, the page says why.
    const second = await register('Tanvir Alam');
    expect(second).not.toBe(first);
    await page.getByLabel(/transaction id \(trxid\)/i).fill(edited);
    await page.getByLabel('Number you sent from').fill('1712345678');
    await page.getByRole('button', { name: /i have sent the money/i }).click();
    await expect(page.getByRole('alert').first()).toContainText(
      /transaction id has already been used/i,
    );
    await expect(page.getByText('Awaiting payment')).toBeVisible();
    await expect(page.getByLabel(/transaction id \(trxid\)/i)).toHaveValue(edited);
  });
});
