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

/** Registers one ticket and lands on the order page. */
async function newOrder(page: Page, slug: string) {
  await page.goto(`/events/${slug}/register`);
  await page.getByRole('radio', { name: /general/i }).check();
  await page.getByLabel('Full name').fill('Nusrat Jahan');
  await page.getByLabel('Email address').fill('buyer@example.com');
  await page.getByLabel('Mobile number').fill('1712345678');
  await page.getByLabel(/I agree to the terms/).check();
  await page.getByRole('button', { name: /continue to payment/i }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
}

// Settings are global: this spec changes the organizer name, support
// details and the Facebook link for the whole e2e run. No other spec asserts
// on those strings; `prepare-db.ts` truncates `settings` before each run.
// If a second spec ever saves settings, make this describe serial.
test.describe('settings (B14)', () => {
  test('saved settings drive the payment page, emails wording, contact and FAQ; a bad save keeps the input', async ({
    page,
  }) => {
    test.slow();
    await signIn(page);

    // The nav item is live.
    await page
      .getByRole('navigation', { name: 'Admin' })
      .getByRole('link', { name: 'Settings' })
      .click();
    await expect(page).toHaveURL(/\/admin\/settings$/);
    await expect(page.getByText(/Not saved yet/)).toBeVisible();

    // A bad number is refused inline; the other fields keep what was typed.
    await page.getByLabel('Receiving number').fill('12345');
    await page.getByLabel('Account name').fill('Echo Events Ltd');
    await page.getByLabel('Verification promise').fill('within the hour');
    await page.getByRole('button', { name: /save settings/i }).click();
    // Next's route announcer is also role=alert: filter by text.
    await expect(page.getByRole('alert').filter({ hasText: /10 digits/ })).toBeVisible();
    await expect(page.getByLabel('Account name')).toHaveValue('Echo Events Ltd');
    await expect(page.getByLabel('Verification promise')).toHaveValue('within the hour');

    // A valid save: merchant account, new number, support details, name.
    await page.getByLabel('Receiving number').fill('01999-111222');
    await page.getByRole('radio', { name: 'Merchant' }).check();
    await page.getByLabel('Support email').fill('support@example.com');
    await page.getByLabel('Support phone').fill('+880 1811 222333');
    await page.getByLabel('Facebook page').fill('https://facebook.com/echoandaura');
    await page.getByLabel('Organizer name').fill('Rajibul');
    await page.getByRole('button', { name: /save settings/i }).click();
    await expect(page).toHaveURL(/saved=1/);
    await expect(page.getByRole('status')).toContainText(/Saved/);
    await expect(page.getByText(/Last saved .* by admin@example.com/)).toBeVisible();
    // Normalised on the way in.
    await expect(page.getByLabel('Receiving number')).toHaveValue('01999 111222');
    await expect(page.getByLabel('Support phone')).toHaveValue('01811 222333');

    // Payment page: the new number, the merchant wording, the account name, the promise.
    const slug = await publishedEvent(page, `Settings ${Date.now()}`);
    await newOrder(page, slug);
    await expect(page.getByTestId('bkash-menu')).toHaveText('Payment');
    await expect(page.getByText('01999 111222').first()).toBeVisible();
    await expect(page.getByText(/in the name of Echo Events Ltd/)).toBeVisible();
    await expect(page.getByText(/within the hour/).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'support@example.com' }).first()).toBeVisible();

    // Contact card, FAQ, footer.
    await page.goto('/contact');
    await expect(page.getByText(/Rajibul runs everything/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'support@example.com' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: '01811 222333' })).toHaveAttribute(
      'href',
      'tel:01811222333',
    );
    await page.goto('/faq');
    await page.getByText('How long until my tickets arrive?').click();
    await expect(page.getByText(/within the hour/).first()).toBeVisible();
    await expect(
      page
        .getByRole('contentinfo')
        .getByRole('link', { name: /facebook/i })
        .first(),
    ).toHaveAttribute('href', 'https://facebook.com/echoandaura');

    // Back to personal: the payment page says "Send Money" again.
    await page.goto('/admin/settings');
    await page.getByRole('radio', { name: 'Personal' }).check();
    await page.getByLabel('Account name').fill('');
    await page.getByRole('button', { name: /save settings/i }).click();
    await expect(page).toHaveURL(/saved=1/);
    await newOrder(page, slug);
    await expect(page.getByTestId('bkash-menu')).toHaveText('Send Money');
    await expect(page.getByText(/it is a personal account/)).toBeVisible();
  });

  test('a signed-out visitor is sent to the login page', async ({ page }) => {
    const res = await page.request.get('/admin/settings', { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(res.status());
  });
});
