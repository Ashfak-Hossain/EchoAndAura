import { expect, test } from '@playwright/test';

// Requires a seeded admin (pnpm admin:create) matching these credentials.
const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'correct-horse-battery';

test.describe('admin login', () => {
  test('unauthenticated /admin redirects to the login page', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test('a wrong password shows an error and stays on the login page', async ({ page }) => {
    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('definitely-the-wrong-password');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    // Filter by text: Next.js also renders its own role="alert" route announcer.
    await expect(
      page.getByRole('alert').filter({ hasText: /invalid email or password/i }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login$/);

    // B1 invalid state: email kept, password cleared, both fields marked.
    await expect(page.getByLabel('Email')).toHaveValue(email);
    await expect(page.getByLabel('Password')).toHaveValue('');
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Password')).toHaveAttribute('aria-invalid', 'true');
  });

  test('correct credentials reach the dashboard; sign-out guards again', async ({ page }) => {
    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    // Six workers share one Node process; a PDF render elsewhere can hold the
    // event loop for seconds, so the sign-in action gets a realistic budget.
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

    // B2 has a Sign out in the sidebar footer and one in the header; either works.
    await page
      .getByRole('banner')
      .getByRole('button', { name: /sign out/i })
      .click();
    await expect(page).toHaveURL(/\/admin\/login$/);

    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});
