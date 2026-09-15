import { expect, test } from '@playwright/test';

// Foundation smoke test: the app boots and the home page responds.
test('home page responds', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();
});
