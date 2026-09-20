import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Requires a seeded admin (pnpm admin:create), MinIO, and — for the sign-in
// flow — E2E_EXPOSE_MAGIC_LINK=1 on the server under test.
const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'correct-horse-battery';
const COVER = path.join(__dirname, 'fixtures', 'cover.png');

async function signInAdmin(page: Page) {
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
  // The admin session must not leak into the buyer flows below.
  await page.context().clearCookies();
  return slug;
}

test.describe('buyer access without an account, and with one', () => {
  test('one name per order; Find my order by reference + phone; wrong phone refused', async ({
    page,
  }) => {
    await signInAdmin(page);
    const slug = await publishedEvent(page, `Account ${Date.now()}`);

    await page.goto(`/events/${slug}/register`);
    await page.getByRole('radio', { name: /general/i }).check();
    await page.getByRole('button', { name: /more tickets/i }).click();
    // No per-ticket name fields any more.
    await expect(page.getByLabel(/attendee name/i)).toHaveCount(0);
    await page.getByLabel('Full name').fill('Nusrat Jahan');
    await page.getByLabel('Email address').fill(`nusrat-${Date.now()}@example.com`);
    await page.getByLabel('Mobile number').fill('1712345678');
    await page.getByLabel(/I agree to the terms/).check();
    await page.getByRole('button', { name: /continue to payment/i }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    const orderUrl = page.url();
    const reference = (await page.getByTestId('order-reference').textContent())!;

    // Closed the tab: come back through Find my order.
    await page.context().clearCookies();
    await page.goto('/orders/find');
    await page.getByLabel('Order reference').fill(reference.toLowerCase());
    await page.getByLabel(/mobile number/i).fill('01712345678');
    await page.getByRole('button', { name: /find my order/i }).click();
    await expect(page).toHaveURL(orderUrl);
    await expect(page.getByText('Awaiting payment')).toBeVisible();

    await page.goto('/orders/find');
    await page.getByLabel('Order reference').fill(reference);
    await page.getByLabel(/mobile number/i).fill('1999999999');
    await page.getByRole('button', { name: /find my order/i }).click();
    await expect(page.getByRole('alert').filter({ hasText: /no order matches/i })).toBeVisible();
    await expect(page).toHaveURL(/\/orders\/find$/);
  });

  test('sign in by email link → My orders lists the order → sign out; buyers cannot reach /admin', async ({
    page,
  }) => {
    await signInAdmin(page);
    const slug = await publishedEvent(page, `Account Login ${Date.now()}`);
    const buyer = `buyer-${Date.now()}@example.com`;

    await page.goto(`/events/${slug}/register`);
    await page.getByRole('radio', { name: /general/i }).check();
    await page.getByLabel('Full name').fill('Tanvir Alam');
    await page.getByLabel('Email address').fill(buyer);
    await page.getByLabel('Mobile number').fill('1712345678');
    await page.getByLabel(/I agree to the terms/).check();
    await page.getByRole('button', { name: /continue to payment/i }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    const reference = (await page.getByTestId('order-reference').textContent())!;

    // Anonymous: header offers Sign in.
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Site', exact: true })
      .getByRole('link', { name: 'Sign in' })
      .click();
    await expect(page).toHaveURL(/\/account\/sign-in$/);
    await page.getByLabel('Email address').fill(buyer.toUpperCase());
    await page.getByRole('button', { name: /email me a sign-in link/i }).click();
    await expect(page.getByRole('status')).toContainText(/check your inbox/i);

    // The link is exposed only because the server runs with E2E_EXPOSE_MAGIC_LINK=1.
    const link = page.getByTestId('exposed-magic-link');
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByText(`Signed in as ${buyer}`)).toBeVisible();
    await expect(page.getByTestId('my-orders')).toContainText(reference);

    // A buyer session is not an admin session.
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/$/);

    // Registration pre-fills from the session.
    await page.goto(`/events/${slug}/register`);
    await expect(page.getByLabel('Email address')).toHaveValue(buyer);

    await page.goto('/account');
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/account');
    await expect(page).toHaveURL(/\/account\/sign-in$/);
  });
});
