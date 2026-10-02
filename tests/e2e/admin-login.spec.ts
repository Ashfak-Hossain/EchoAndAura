import { expect, test } from './test';
import { E2E_ADMIN, signInAsAdmin } from './fixtures/admin';

const { email } = E2E_ADMIN;

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

  test('correct credentials and code reach the dashboard; sign-out guards again', async ({
    page,
  }) => {
    // Password → code page → dashboard (ADR-049; admin-two-factor.spec.ts
    // covers the code step itself).
    await signInAsAdmin(page);
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
