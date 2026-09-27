import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

// Requires a seeded admin (pnpm admin:create) and MinIO (docker compose).
// ADR-033: covers are served through Next's image optimizer, sized per
// placement, and the optimizer fetches from the storage host only.
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

async function openTab(page: Page, name: 'Cover image' | 'Ticket types' | 'Publish') {
  await page
    .getByRole('navigation', { name: /event sections/i })
    .getByRole('link', { name })
    .click();
}

/**
 * A cover the size organisers really upload (the fixture is 16×9): a
 * gradient with shapes, 2400×1260, so there is something to shrink.
 */
async function realisticCover(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1260">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1a2a20"/><stop offset="1" stop-color="#e2962c"/>
    </linearGradient></defs>
    <rect width="2400" height="1260" fill="url(#g)"/>
    ${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 197) % 2400}" cy="${(i * 331) % 1260}" r="${40 + ((i * 53) % 160)}" fill="#fbfaf8" fill-opacity="0.${(i % 8) + 1}"/>`).join('')}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** The storage URL behind an optimizer src. */
function sourceOf(optimized: string): string {
  const url = new URL(optimized, 'http://x');
  expect(url.pathname).toBe('/_next/image');
  return url.searchParams.get('url') ?? '';
}

test.describe('event covers through the image optimizer (ADR-033)', () => {
  test('the page gets a resized WebP of the stored cover, and phones a small one', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    await page.goto('/admin/events/new');
    await page.getByLabel('Title', { exact: true }).fill(`Image Test ${Date.now()}`);
    await page.getByLabel('Venue', { exact: true }).fill('ICCB Hall 4, Dhaka');
    await page.getByLabel(/^Starts at/).fill('2030-10-01T19:00');
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
    await page.getByLabel('Quantity', { exact: true }).fill('100');
    await page.getByRole('button', { name: /add ticket type/i }).click();
    await expect(page).toHaveURL(/tab=ticket-types$/);

    await openTab(page, 'Cover image');
    await page.getByTestId('cover-file').setInputFiles({
      name: 'cover.png',
      mimeType: 'image/png',
      buffer: await realisticCover(),
    });
    await expect(page.getByTestId('cover-image')).toBeVisible();

    await openTab(page, 'Publish');
    await page.getByRole('button', { name: /^publish$/i }).click();
    await expect(page.getByTestId('event-status')).toHaveText('published');

    // Desktop: the backdrop cover.
    await page.goto(`/events/${slug}`);
    const backdrop = page.getByTestId('event-cover');
    await expect(backdrop).toBeVisible();
    await expect
      .poll(() => backdrop.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
    const chosen = await backdrop.evaluate((img: HTMLImageElement) => img.currentSrc);
    const stored = sourceOf(chosen);
    expect(stored).toMatch(/\/events\/[0-9a-f-]{36}\/cover-[A-Za-z0-9_-]{12}\.png$/);
    expect(await backdrop.getAttribute('sizes')).toBe('100vw');

    const original = await page.request.get(stored);
    expect(original.status()).toBe(200);
    const optimized = await page.request.get(chosen, { headers: { Accept: 'image/webp,*/*' } });
    expect(optimized.status()).toBe(200);
    expect(optimized.headers()['content-type']).toBe('image/webp');
    expect((await optimized.body()).byteLength).toBeLessThan((await original.body()).byteLength);

    // A phone gets a phone-sized file, not the 2400px upload. A fresh
    // context: Chrome may reuse a larger srcset candidate it already holds.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phonePage = await phone.newPage();
    await phonePage.goto(`/events/${slug}`);
    const band = phonePage.getByTestId('event-cover-mobile');
    await expect(band).toBeVisible();
    await expect
      .poll(() => band.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
    const phoneSrc = new URL(
      await band.evaluate((img: HTMLImageElement) => img.currentSrc),
      'http://x',
    );
    expect(Number(phoneSrc.searchParams.get('w'))).toBeLessThanOrEqual(828);
    expect(phoneSrc.searchParams.get('url')).toBe(stored);
    await phone.close();
  });

  test('the optimizer fetches from the storage bucket only', async ({ request }) => {
    const bad = (url: string) =>
      request.get(`/_next/image?url=${encodeURIComponent(url)}&w=640&q=75`);
    // Another host entirely.
    expect((await bad('https://example.com/cover.png')).status()).toBe(400);
    // The storage host, but outside the bucket's path.
    const storage = new URL(process.env.R2_PUBLIC_URL ?? 'http://localhost:9000/echoandaura');
    expect((await bad(`${storage.origin}/not-the-bucket/cover.png`)).status()).toBe(400);
  });
});
