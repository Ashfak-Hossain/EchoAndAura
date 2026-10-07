import { test, expect } from '@playwright/test';

test('static pages, search, source links, themes and narrow layouts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('link', { name: 'Explore the system' }).click();
  await expect(
    page.getByRole('heading', { name: 'How the system fits together', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('overview-light.png'), fullPage: true });
  await expect(page.getByRole('link', { name: 'Order service', exact: true })).toHaveAttribute(
    'href',
    /\/blob\/[a-f0-9]{40}\/src\//,
  );
  const trigger = page.getByRole('button', { name: /Search/ }).first();
  await trigger.click();
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('combobox');
  await input.fill('reading the codebase');
  await expect(dialog.getByRole('option', { name: /Reading the codebase/ }).first()).toBeVisible();
  await input.fill('zzznomatchingdocumentzzz');
  await expect(dialog.getByRole('option')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.getByRole('link', { name: 'reading the codebase', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Reading the codebase', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Reading the codebase', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.goto('/docs/');
  await page.screenshot({ path: test.info().outputPath('overview-dark.png'), fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/docs/');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`overview-${width}.png`),
      fullPage: true,
    });
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll('main *')]
        .filter((element) => element.getBoundingClientRect().right > innerWidth + 1)
        .map((element) => ({
          tag: element.tagName,
          class: element.className,
          width: element.getBoundingClientRect().width,
        }))
        .slice(0, 12),
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `overflow at ${width}px: ${JSON.stringify(overflow)}`,
    ).toBe(true);
  }
  const missing = await page.goto('/docs/missing-page/');
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  expect(errors).toEqual([]);
});
