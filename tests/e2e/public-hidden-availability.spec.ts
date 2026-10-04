import path from 'node:path';
import { expect, test, type Page } from './test';
import { signInAsAdmin } from './fixtures/admin';

// Requires MinIO (docker compose).
const COVER = path.join(__dirname, 'fixtures', 'cover.png');

/** Any "N left" wording: the chip, the compact line, the hero, the register rows. */
const COUNT_LEFT = /\d+\s+(tickets?\s+)?left/i;

async function openTab(page: Page, name: 'Details' | 'Cover image' | 'Ticket types' | 'Publish') {
  await page
    .getByRole('navigation', { name: /event sections/i })
    .getByRole('link', { name })
    .click();
}

/**
 * A published event that hides its counts (ADR-055), with one ticket type,
 * Few Seats (৳700 × 3). Returns the slug and the admin edit URL.
 */
async function hiddenCountEvent(
  page: Page,
  title: string,
): Promise<{ slug: string; edit: string }> {
  await page.goto('/admin/events/new');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Venue', { exact: true }).fill('ICCB Hall 4, Dhaka');
  await page.getByLabel(/^Starts at/).fill('2030-10-01T19:00');
  await page.getByLabel(/^Registration opens/).fill('2026-01-01T10:00');
  await page.getByLabel(/hide how many tickets are left/i).check();
  await page.getByRole('button', { name: /create event/i }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/edit$/);
  const edit = new URL(page.url()).pathname;
  const slug = await page.getByLabel(/^URL slug/).inputValue();

  await openTab(page, 'Ticket types');
  await page
    .getByRole('link', { name: /add ticket type/i })
    .first()
    .click();
  await page.getByLabel('Name', { exact: true }).fill('Few Seats');
  await page.getByLabel(/^Price/).fill('700');
  await page.getByLabel('Quantity', { exact: true }).fill('3');
  await page.getByRole('button', { name: /add ticket type/i }).click();
  await expect(page).toHaveURL(/tab=ticket-types$/);

  await openTab(page, 'Cover image');
  await page.getByTestId('cover-file').setInputFiles(COVER);
  await expect(page.getByTestId('cover-image')).toBeVisible();
  await openTab(page, 'Publish');
  await page.getByRole('button', { name: /^publish$/i }).click();
  await expect(page.getByTestId('event-status')).toHaveText('published');
  return { slug, edit };
}

/** The visible ticket row, whichever layout (desktop column or phone sheet) is showing. */
function ticketRow(page: Page) {
  return page.locator('li:visible').filter({ hasText: 'Few Seats' }).first();
}

test.describe('hidden ticket counts (ADR-055)', () => {
  test('the public never sees how many are left, the server still refuses too many, and Sold out stays public', async ({
    page,
    browser,
  }) => {
    await signInAsAdmin(page);
    const { slug, edit } = await hiddenCountEvent(page, `Hidden Counts ${Date.now()}`);

    // The admin sees the setting kept, and the plain-words summary says so.
    await page.goto(edit);
    await expect(page.getByLabel(/hide how many tickets are left/i)).toBeChecked();
    await expect(page.getByTestId('availability-hidden-summary')).toContainText(/hidden/i);

    // Event page, desktop: the row and its price, but no count anywhere.
    await page.goto(`/events/${slug}`);
    await expect(ticketRow(page)).toContainText('৳700');
    await expect(page.locator('body')).not.toContainText(COUNT_LEFT);
    expect(await page.content()).not.toMatch(COUNT_LEFT);

    // Event page, phone.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobile = await phone.newPage();
    await mobile.goto(`/events/${slug}`);
    await expect(ticketRow(mobile)).toContainText('৳700');
    await expect(mobile.locator('body')).not.toContainText(COUNT_LEFT);
    await phone.close();

    // Register page: no "left", and the stepper goes past the 3 in stock to 10.
    await page.goto(`/events/${slug}/register`);
    const radio = page.getByRole('radio', { name: /few seats/i });
    await radio.check();
    await expect(page.locator('body')).not.toContainText(/\bleft\b/i);
    const more = page.getByRole('button', { name: /more tickets/i });
    for (let i = 0; i < 9; i++) await more.click();
    await expect(page.getByLabel('Number of tickets')).toHaveValue('10');
    await expect(more).toBeDisabled();

    // The count never reaches the browser: the options are serialised with
    // `available: null` (escaped inside the RSC payload), never the 3.
    const html = await page.content();
    expect(html).toMatch(/\\?"available\\?":null/);
    expect(html).not.toMatch(/\\?"available\\?":\d/);

    // Five is more than remain: refused, and the row stays choosable.
    const fewer = page.getByRole('button', { name: /fewer tickets/i });
    for (let i = 0; i < 5; i++) await fewer.click();
    await expect(page.getByLabel('Number of tickets')).toHaveValue('5');
    await page.getByLabel('Full name').fill('Nusrat Jahan');
    await page.getByLabel('Email address').fill('nusrat.jahan@example.com');
    await page.getByLabel('Mobile number').fill('1712345678');
    await page.getByLabel(/I agree to the terms/).check();
    await page.getByRole('button', { name: /continue to payment/i }).click();
    await expect(page.getByRole('alert').first()).toContainText('Not that many tickets are left');
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByRole('alert').first()).not.toContainText(/\d/);
    await expect(radio).toBeEnabled();
    await expect(page.getByLabel('Full name')).toHaveValue('Nusrat Jahan');

    // Three fit exactly.
    await radio.check();
    const qty = page.getByLabel('Number of tickets');
    while ((await qty.inputValue()) !== '3') {
      const n = Number(await qty.inputValue());
      await (n > 3 ? fewer : more).click();
      await expect(qty).not.toHaveValue(String(n));
    }
    await page.getByLabel(/I agree to the terms/).check();
    await page.getByRole('button', { name: /continue to payment/i }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByText('3 × Few Seats')).toBeVisible();

    // All three held: "Sold out" is still public.
    await page.goto(`/events/${slug}`);
    await expect(ticketRow(page)).toContainText('Sold out');
    await expect(page.locator('body')).not.toContainText(COUNT_LEFT);
  });
});
