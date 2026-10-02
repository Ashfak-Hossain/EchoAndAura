import path from 'node:path';
import { expect, test, type Page } from './test';
import { signInAsAdmin } from './fixtures/admin';

// Requires a seeded admin (pnpm admin:create) matching these credentials,
// and MinIO from docker compose (R2_* in .env).
const fixture = (name: string) => path.join(__dirname, 'fixtures', name);

async function createEvent(page: Page, title: string) {
  await page.goto('/admin/events/new');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel(/^Starts at/).fill('2030-10-01T19:00');
  await page.getByRole('button', { name: /create event/i }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/edit$/);
  // B5 editor tabs are URL state; the cover lives on its own tab.
  await page
    .getByRole('navigation', { name: /event sections/i })
    .getByRole('link', { name: 'Cover image' })
    .click();
}

test.describe('admin event cover image', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test('upload → visible from storage → replace → remove', async ({ page }) => {
    await createEvent(page, `E2E Cover ${Date.now()}`);
    await expect(page.getByTestId('no-cover-image')).toBeVisible();

    await page.getByTestId('cover-file').setInputFiles(fixture('cover.png'));
    const img = page.getByTestId('cover-image');
    await expect(img).toBeVisible();

    // The object lives in storage (MinIO locally); the page shows it through
    // Next's optimizer, which names it in `url` (ADR-033).
    const storedUrl = async () =>
      new URL((await img.getAttribute('src'))!, 'http://x').searchParams.get('url')!;
    const firstSrc = await storedUrl();
    expect(firstSrc).toMatch(/^http:\/\/localhost:9000\/.+\/events\/[0-9a-f-]{36}\/cover-.+\.png$/);
    const served = await page.request.get(firstSrc);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('image/png');

    // Replace: a new key (so no cached copy of the old one can show), and
    // the old object is gone.
    await page.getByTestId('cover-file').setInputFiles(fixture('cover.png'));
    await expect.poll(storedUrl).not.toBe(firstSrc);
    await expect.poll(async () => (await page.request.get(firstSrc)).status()).toBe(404);

    // Remove.
    await page.getByRole('button', { name: /remove cover image/i }).click();
    await expect(page.getByTestId('no-cover-image')).toBeVisible();
  });

  test('a non-image file is rejected before anything is uploaded', async ({ page }) => {
    await createEvent(page, `E2E Cover reject ${Date.now()}`);
    await page.getByTestId('cover-file').setInputFiles(fixture('not-an-image.txt'));
    await expect(
      page.getByRole('alert').filter({ hasText: /must be a JPEG, PNG or WebP/i }),
    ).toBeVisible();
    await expect(page.getByTestId('no-cover-image')).toBeVisible();
  });
});
