import { test, expect } from '@playwright/test';

test('ticket tour renders live excerpts and checked type information', async ({ page }) => {
  await page.goto('/docs/tours/buy-a-ticket/');
  await expect(page.getByRole('heading', { name: 'Buy a ticket', exact: true })).toBeVisible();
  await expect(page.locator('pre').filter({ hasText: 'Number.isInteger(quantity)' })).toHaveCount(
    1,
  );
  await expect(page.locator('pre').filter({ hasText: 'return rows.length === 1' })).toHaveCount(1);
  await expect(page.locator('.twoslash')).not.toHaveCount(0);
  const typeTrigger = page
    .locator('button.twoslash-hover')
    .filter({ hasText: 'isValidOrderQuantity' })
    .first();
  await typeTrigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.fd-twoslash-popover')).toBeVisible();
  await expect(page.locator('.fd-twoslash-popover')).toContainText('boolean');
  await page.keyboard.press('Escape');
  await expect(page.locator('.fd-twoslash-popover')).not.toBeVisible();
  await expect(page.getByRole('link', { name: 'email dispatcher', exact: true })).toHaveAttribute(
    'href',
    /\/src\/server\/email\/dispatch.ts$/,
  );
  await page.screenshot({ path: test.info().outputPath('tour-light.png'), fullPage: true });
});

test('last ticket walkthrough supports either winner, keyboard, reset and narrow themes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/docs/concepts/last-ticket/');
  const race = page.getByRole('region', { name: 'Two buyers race for the last ticket' });
  const next = race.getByRole('button', { name: 'Next step' });
  const previous = race.getByRole('button', { name: 'Previous step' });
  for (const buyer of ['A', 'B']) {
    await race.getByRole('button', { name: `Buyer ${buyer}`, exact: true }).click();
    await expect(previous).toBeDisabled();
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(
      race.getByRole('heading', { name: `Buyer ${buyer} reserves the ticket` }),
    ).toBeVisible();
    await expect(
      race.getByText("Counters show the winner's uncommitted view.", { exact: false }),
    ).toBeVisible();
    await next.click();
    await expect(
      race.getByRole('heading', { name: `Buyer ${buyer} commits the order` }),
    ).toBeVisible();
    await next.click();
    await expect(
      race.getByRole('heading', { name: `Buyer ${buyer === 'A' ? 'B' : 'A'} is refused` }),
    ).toBeVisible();
    await expect(next).toBeDisabled();
    await previous.click();
    await expect(next).toBeEnabled();
    await race.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(previous).toBeDisabled();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => localStorage.setItem('theme', value), theme);
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/docs/concepts/last-ticket/');
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await next.click();
      await race.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: test.info().outputPath(`race-${theme}-${width}.png`),
        fullPage: true,
      });
      for (const route of ['tours/buy-a-ticket', 'reference/order-states']) {
        await page.goto(`/docs/${route}/`);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true);
      }
      await page.goto('/docs/tours/buy-a-ticket/');
      await page.screenshot({ path: test.info().outputPath(`tour-${theme}-${width}.png`) });
    }
  }
  expect(errors).toEqual([]);
});
