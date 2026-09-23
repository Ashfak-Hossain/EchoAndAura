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

async function addTicketType(page: Page, name: string, price: string) {
  await openTab(page, 'Ticket types');
  await page
    .getByRole('link', { name: /add ticket type/i })
    .first()
    .click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel(/^Price/).fill(price);
  await page.getByLabel('Quantity', { exact: true }).fill('20');
  await page.getByRole('button', { name: /add ticket type/i }).click();
}

/** A published event with General (৳1,200) and VIP (৳3,500). Returns { title, slug }. */
async function publishedEvent(page: Page, title: string) {
  await page.goto('/admin/events/new');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Venue', { exact: true }).fill('ICCB Hall 4, Dhaka');
  await page.getByLabel(/^Starts at/).fill('2030-10-01T19:00');
  await page.getByLabel(/^Registration opens/).fill('2026-01-01T10:00');
  await page.getByRole('button', { name: /create event/i }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/edit$/);
  const slug = await page.getByLabel(/^URL slug/).inputValue();
  await addTicketType(page, 'General', '1200');
  await addTicketType(page, 'VIP', '3500');
  await openTab(page, 'Cover image');
  await page.getByTestId('cover-file').setInputFiles(COVER);
  await expect(page.getByTestId('cover-image')).toBeVisible();
  await openTab(page, 'Publish');
  await page.getByRole('button', { name: /^publish$/i }).click();
  await expect(page.getByTestId('event-status')).toHaveText('published');
  return { title, slug };
}

/** The sheet's own fields (the dialog is labelled "Code" too, hence the roles). */
const sheet = (page: Page) => page.getByRole('dialog');

async function startRegistration(page: Page, slug: string, type: RegExp, quantity: number) {
  await page.goto(`/events/${slug}/register`);
  await page.getByRole('radio', { name: type }).check();
  for (let i = 1; i < quantity; i++) {
    await page.getByRole('button', { name: /more tickets/i }).click();
  }
}

async function apply(page: Page, code: string) {
  await page.locator('#promoCode').fill(code);
  await page.getByRole('button', { name: 'Apply' }).click();
}

test.describe('promo codes (B10)', () => {
  test('create → apply at registration → order priced by the server → switch off → edit → delete', async ({
    page,
  }) => {
    test.slow();
    await signIn(page);
    const { title, slug } = await publishedEvent(page, `Promo ${Date.now()}`);
    const code = `DHAKA${Date.now().toString(36).toUpperCase().slice(-4)}`;

    // The nav is live; the sheet is URL-driven.
    await page.goto('/admin');
    await page
      .getByRole('navigation', { name: 'Admin' })
      .getByRole('link', { name: 'Promo codes' })
      .click();
    await expect(page).toHaveURL(/\/admin\/promo-codes$/, { timeout: 20_000 });
    await page.goto('/admin/promo-codes?new=1');
    await page.waitForLoadState('networkidle');

    // Validation keeps the input and marks the field. The scope is never
    // pre-chosen — the widest one is not a default.
    await sheet(page).getByRole('textbox', { name: 'Code' }).fill(code.toLowerCase());
    await sheet(page).getByRole('textbox', { name: 'Value' }).fill('150');
    await sheet(page).getByRole('button', { name: 'Create code' }).click();
    await expect(sheet(page).getByRole('alert')).toContainText(
      'Choose Any ticket type or Only these',
    );
    await expect(sheet(page).getByRole('textbox', { name: 'Code' })).toHaveValue(code);
    await page.waitForLoadState('networkidle');

    // "Only these" with nothing ticked is refused — never a silent "everything".
    await sheet(page).getByRole('radio', { name: 'Only these ticket types' }).check();
    await sheet(page).getByRole('button', { name: 'Create code' }).click();
    await expect(sheet(page).getByRole('alert')).toContainText('Tick at least one ticket type');
    await page.waitForLoadState('networkidle');
    await expect(sheet(page).getByRole('radio', { name: 'Only these ticket types' })).toBeChecked();
    const group = sheet(page)
      .locator('div')
      .filter({ has: page.getByText(title, { exact: true }) })
      .last();
    await group.getByRole('checkbox', { name: /General/ }).check();

    // 150% is refused (1–99: a code never makes a ticket free).
    await sheet(page).getByRole('button', { name: 'Create code' }).click();
    await expect(sheet(page).getByRole('alert')).toContainText('1 – 99');
    await page.waitForLoadState('networkidle');

    // 15% on this event's General; the preview is the per-ticket price.
    await sheet(page).getByRole('textbox', { name: 'Value' }).fill('15');
    await expect(sheet(page).getByTestId('promo-preview')).toHaveText(
      'A General ticket becomes ৳1,020.00.',
    );
    await sheet(page).getByRole('button', { name: 'Create code' }).click();
    await expect(page).toHaveURL(new RegExp(`saved=${code}&created=1`));
    await expect(page.getByRole('status')).toContainText(`${code} created.`);
    const row = page.getByTestId('promo-row').filter({ hasText: code });
    await expect(row).toContainText('15%');
    await expect(row).toContainText(`General · ${title}`);

    // A duplicate code is refused.
    await page.goto('/admin/promo-codes?new=1');
    await page.waitForLoadState('networkidle');
    await sheet(page).getByRole('textbox', { name: 'Code' }).fill(code);
    await sheet(page).getByRole('textbox', { name: 'Value' }).fill('5');
    await sheet(page).getByRole('radio', { name: 'Any ticket type, in any event' }).check();
    await sheet(page).getByRole('button', { name: 'Create code' }).click();
    await expect(sheet(page).getByRole('alert')).toContainText('already exists');

    // Buyer: an unknown code, then the real one typed in lower case.
    await startRegistration(page, slug, /general/i, 2);
    await apply(page, 'nope');
    await expect(page.locator('#promoCode-error')).toHaveText(
      'That code is not valid for this event.',
    );
    await apply(page, code.toLowerCase());
    await expect(page.getByTestId('promo-applied')).toContainText(`${code} applied — 15% off`);
    await expect(page.getByTestId('summary-discount')).toContainText('−৳360.00');
    await expect(page.getByTestId('summary-total')).toHaveText('৳2,040.00');
    // VIP is not covered: the chip says so and the discount leaves the summary.
    await page.getByRole('radio', { name: /vip/i }).check();
    await expect(page.getByTestId('promo-applied')).toContainText('does not apply to VIP tickets');
    await expect(page.getByTestId('summary-discount')).toHaveCount(0);
    await expect(page.getByTestId('summary-total')).toHaveText('৳7,000.00');
    await page.getByRole('radio', { name: /general/i }).check();
    await page.getByLabel('Full name').fill('Nusrat Jahan');
    await page.getByLabel('Email address').fill('buyer@example.com');
    await page.getByLabel('Mobile number').fill('1712345678');
    await page.getByLabel(/I agree to the terms/).check();
    await page.getByRole('button', { name: /continue to payment/i }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);

    // A4: the server priced it — and says with which code.
    await expect(page.getByTestId('order-discount')).toContainText(
      `৳2,400.00 − ৳360.00 with ${code}`,
    );
    await expect(page.getByText('৳2,040.00').first()).toBeVisible();
    const orderRef = (await page.getByTestId('order-reference').textContent())!;

    // B8 names the code; the table counts it as pending.
    await page.goto(`/admin/orders?q=${orderRef}`);
    await page.getByTestId('order-row').first().getByRole('link').first().click();
    await expect(page.getByText(`Discount · ${code}`)).toBeVisible();
    await page.goto('/admin/promo-codes');
    await expect(row.getByTestId('promo-uses')).toContainText('0 · +1 pending');

    // Switch it off: a new registration can no longer use it. The switch is a
    // client island; a click before hydration does nothing, so retry the
    // click until it flips (the optimistic flip is instant once hydrated).
    const toggle = row.getByRole('switch').first();
    await expect(async () => {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    // The flip is optimistic; let the server action land before reloading.
    await expect(toggle).not.toHaveAttribute('data-disabled');
    await page.waitForLoadState('networkidle');
    await page.reload();
    await expect(row.getByRole('switch').first()).not.toBeChecked();
    await startRegistration(page, slug, /general/i, 1);
    await apply(page, code);
    await expect(page.locator('#promoCode-error')).toHaveText(
      'That code is not valid for this event.',
    );
    // A code left in the field is still checked on submit — refused, not ignored.
    await page.getByLabel('Full name').fill('Tanvir Alam');
    await page.getByLabel('Email address').fill('buyer2@example.com');
    await page.getByLabel('Mobile number').fill('1812345678');
    await page.getByLabel(/I agree to the terms/).check();
    await page.getByRole('button', { name: /continue to payment/i }).click();
    await expect(page.locator('#promoCode-error')).toHaveText(
      'That code is not valid for this event.',
    );
    await expect(page).toHaveURL(/\/register$/);

    // Edit to ৳200 fixed, any ticket type, back on: VIP now gets ৳200 off.
    await page.goto(`/admin/promo-codes`);
    await row.getByRole('link', { name: 'Edit' }).click();
    await expect(sheet(page).getByTestId('edit-code')).toHaveText(code);
    // The sheet form is a client island: interact only once it is hydrated,
    // or React resets the controlled fields when it takes over.
    await page.waitForLoadState('networkidle');
    await sheet(page).getByText('Fixed ৳').click();
    await expect(sheet(page).getByRole('radio', { name: 'Fixed ৳' })).toBeChecked();
    await sheet(page).getByRole('textbox', { name: 'Value' }).fill('200');
    // Widening to every ticket type is an explicit choice, not an untick.
    await expect(sheet(page).getByRole('radio', { name: 'Only these ticket types' })).toBeChecked();
    await sheet(page).getByRole('radio', { name: 'Any ticket type, in any event' }).check();
    await sheet(page).getByRole('checkbox', { name: 'Active' }).check();
    // A used code offers no delete.
    await expect(sheet(page).getByRole('button', { name: 'Delete code' })).toHaveCount(0);
    await sheet(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status')).toContainText(`${code} saved.`);
    await expect(row).toContainText('৳200.00');
    await expect(row).toContainText('Any ticket type');
    await startRegistration(page, slug, /vip/i, 1);
    await apply(page, code);
    await expect(page.getByTestId('promo-applied')).toContainText('৳200.00 off each ticket');
    await expect(page.getByTestId('summary-total')).toHaveText('৳3,300.00');

    // An unused code can be deleted from its sheet.
    const spare = `SPARE${Date.now().toString(36).toUpperCase().slice(-4)}`;
    await page.goto('/admin/promo-codes?new=1');
    await page.waitForLoadState('networkidle');
    await sheet(page).getByRole('textbox', { name: 'Code' }).fill(spare);
    await sheet(page).getByRole('textbox', { name: 'Value' }).fill('5');
    await sheet(page).getByRole('radio', { name: 'Any ticket type, in any event' }).check();
    await sheet(page).getByRole('button', { name: 'Create code' }).click();
    await expect(page.getByTestId('promo-row').filter({ hasText: spare })).toBeVisible();
    await page
      .getByTestId('promo-row')
      .filter({ hasText: spare })
      .getByRole('link', { name: 'Edit' })
      .click();
    await expect(sheet(page).getByTestId('edit-code')).toHaveText(spare);
    await page.waitForLoadState('networkidle');
    page.once('dialog', (d) => void d.accept());
    await sheet(page).getByRole('button', { name: 'Delete code' }).click();
    await expect(page.getByTestId('promo-row').filter({ hasText: spare })).toHaveCount(0);
  });

  test('a signed-out visitor is sent to the login page', async ({ page }) => {
    const res = await page.request.get('/admin/promo-codes', { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(res.status());
  });
});
