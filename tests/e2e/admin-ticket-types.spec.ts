import { expect, test, type Page } from '@playwright/test';

// Requires a seeded admin (pnpm admin:create) matching these credentials.
const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'correct-horse-battery';

async function signIn(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  // Six workers share one Node process; a PDF render elsewhere can hold the
  // event loop for seconds, so the sign-in action gets a realistic budget.
  await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
}

/** Creates a fresh event, opens its Ticket types tab, and returns that URL. */
async function createEvent(page: Page, title: string): Promise<string> {
  await page.goto('/admin/events/new');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel(/^Starts at/).fill('2030-10-01T19:00');
  await page.getByRole('button', { name: /create event/i }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/edit$/);
  await page
    .getByRole('navigation', { name: /event sections/i })
    .getByRole('link', { name: 'Ticket types' })
    .click();
  await expect(page).toHaveURL(/tab=ticket-types$/);
  return page.url();
}

async function addTicketType(
  page: Page,
  values: {
    name: string;
    price: string;
    quantity: string;
    start?: string;
    end?: string;
  },
) {
  await page
    .getByRole('link', { name: /add ticket type/i })
    .first()
    .click();
  await page.getByLabel('Name', { exact: true }).fill(values.name);
  await page.getByLabel(/^Price/).fill(values.price);
  await page.getByLabel('Quantity', { exact: true }).fill(values.quantity);
  if (values.start) await page.getByLabel(/^Sales start/).fill(values.start);
  if (values.end) await page.getByLabel(/^Sales end/).fill(values.end);
  await page.getByRole('button', { name: /add ticket type/i }).click();
}

test.describe('admin ticket types', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('phase-exit rehearsal: three ticket types on one event', async ({ page }) => {
    const editUrl = await createEvent(page, `E2E Tickets ${Date.now()}`);
    await expect(page.getByText(/add your first ticket type/i)).toBeVisible();

    await addTicketType(page, {
      name: 'Early Bird',
      price: '799.50',
      quantity: '100',
      start: '2030-09-01T00:00',
      end: '2030-09-15T23:59',
    });
    await expect(page).toHaveURL(editUrl);
    await addTicketType(page, {
      name: 'General',
      price: '1200',
      quantity: '400',
    });
    await addTicketType(page, { name: 'VIP', price: '3500', quantity: '50' });

    // All three listed, money formatted from paisa, available = total.
    const rows = page.getByRole('row');
    const earlyBird = rows.filter({ hasText: 'Early Bird' });
    await expect(earlyBird).toContainText('৳799.50');
    await expect(earlyBird).toContainText('1 Sep 2030, 00:00 → 15 Sep 2030, 23:59');
    await expect(rows.filter({ hasText: 'General' })).toContainText('৳1,200.00');
    await expect(rows.filter({ hasText: 'VIP' })).toContainText('৳3,500.00');
    await expect(earlyBird.getByRole('cell')).toHaveCount(8);

    // Edit General: capacity 400 → 450, price prefilled with two decimals.
    await rows.filter({ hasText: 'General' }).getByRole('link', { name: /edit/i }).click();
    await expect(page.getByLabel(/^Price/)).toHaveValue('1200.00');
    await page.getByLabel('Quantity', { exact: true }).fill('450');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page).toHaveURL(editUrl);
    await expect(rows.filter({ hasText: 'General' })).toContainText('450');

    // Delete VIP (nothing sold or held) — gone from the list.
    await rows.filter({ hasText: 'VIP' }).getByRole('link', { name: /edit/i }).click();
    await page.getByRole('button', { name: /delete ticket type/i }).click();
    await expect(page).toHaveURL(editUrl);
    await expect(rows.filter({ hasText: 'VIP' })).toHaveCount(0);
    await expect(rows.filter({ hasText: 'Early Bird' })).toHaveCount(1);
  });

  test('rejects a malformed price and a backwards sales window inline', async ({ page }) => {
    await createEvent(page, `E2E Tickets validation ${Date.now()}`);

    await addTicketType(page, {
      name: 'Bad price',
      price: '1.999',
      quantity: '10',
    });
    await expect(page.getByRole('alert').filter({ hasText: /price in taka/i })).toBeVisible();

    await page.getByLabel(/^Price/).fill('10');
    await page.getByLabel(/^Sales start/).fill('2030-09-15T00:00');
    await page.getByLabel(/^Sales end/).fill('2030-09-01T00:00');
    await page.getByRole('button', { name: /add ticket type/i }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: /sales must end after they start/i }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/ticket-types\/new$/);
  });

  test('a ticket type is only reachable under its own event', async ({ page }) => {
    const editUrl = await createEvent(page, `E2E Tickets scope ${Date.now()}`);
    await addTicketType(page, { name: 'Solo', price: '1', quantity: '1' });
    await page.getByRole('link', { name: /edit/i }).last().click();
    const ticketTypeUrl = page.url();

    const otherEventUrl = ticketTypeUrl.replace(
      /\/admin\/events\/[0-9a-f-]{36}\//,
      '/admin/events/00000000-0000-0000-0000-000000000000/',
    );
    expect(otherEventUrl).not.toBe(ticketTypeUrl);
    const response = await page.goto(otherEventUrl);
    expect(response?.status()).toBe(404);

    await page.goto(editUrl);
    await expect(page.getByRole('row').filter({ hasText: 'Solo' })).toBeVisible();
  });
});
