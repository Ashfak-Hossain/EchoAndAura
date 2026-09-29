import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { expect, type Page, test } from './test';
import { e2eAppDatabaseUrl } from './prepare-db';

/**
 * ADR-038: an admin's own password and email — change password, forgot →
 * reset, change email. Each test makes its own admin with the real
 * create-admin script (as the app role, like the worker in production),
 * so the shared e2e admin is never touched. Links are
 * read through the test seam (APP_ENV=test, E2E_EXPOSE_MAGIC_LINK=1).
 */

function newAdmin(password: string) {
  const email = `e2e-acct-${randomBytes(4).toString('hex')}@example.com`;
  execFileSync('pnpm', ['exec', 'tsx', 'scripts/create-admin.ts', email, password, 'E2E Admin'], {
    env: { ...process.env, DATABASE_URL: e2eAppDatabaseUrl() },
    stdio: 'pipe',
  });
  return email;
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
}

const alert = (page: Page, text: RegExp) => page.getByRole('alert').filter({ hasText: text });

test.describe('admin account (ADR-038)', () => {
  test('change password: wrong current and mismatch refused, then the new one is the only one', async ({
    page,
  }) => {
    const email = newAdmin('first-password-123');
    await signIn(page, email, 'first-password-123');
    await expect(page).toHaveURL(/\/admin$/);

    await page.getByRole('link', { name: 'Your account' }).first().click();
    await expect(
      page.getByRole('main').getByRole('heading', { name: 'Your account' }),
    ).toBeVisible();

    const current = page.getByLabel('Current password', { exact: true }).first();
    const next = page.getByLabel('New password', { exact: true });
    const again = page.getByLabel('New password again', { exact: true });
    const submit = page.getByRole('button', { name: 'Change password' });

    await current.fill('not-the-password');
    await next.fill('second-password-456');
    await again.fill('second-password-456');
    await submit.click();
    await expect(alert(page, /current password is not right/i)).toBeVisible();

    await current.fill('first-password-123');
    await next.fill('second-password-456');
    await again.fill('second-password-457');
    await submit.click();
    await expect(alert(page, /do not match/i)).toBeVisible();

    await current.fill('first-password-123');
    await next.fill('second-password-456');
    await again.fill('second-password-456');
    await submit.click();
    await expect(page.getByText(/password changed/i)).toBeVisible();

    await page.context().clearCookies();
    await signIn(page, email, 'first-password-123');
    await expect(alert(page, /invalid email or password/i)).toBeVisible();
    await signIn(page, email, 'second-password-456');
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('forgot password: the link resets it once; an unknown address gets the same answer and no link', async ({
    page,
  }) => {
    const email = newAdmin('forgotten-password-1');
    await page.goto('/admin/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/admin\/forgot-password$/);

    await page.getByLabel('Email').fill(email.toUpperCase());
    await page.getByRole('button', { name: 'Send a reset link' }).click();
    await expect(page.getByText(/belongs to an organizer account/i)).toBeVisible();
    const link = page.getByTestId('exposed-reset-link');
    const href = await link.getAttribute('href');
    expect(href).toBeTruthy();
    await link.click();

    await expect(page).toHaveURL(/\/admin\/reset-password\?token=/);
    await page.getByLabel('New password', { exact: true }).fill('a-brand-new-password');
    await page.getByLabel('New password again', { exact: true }).fill('a-brand-new-password');
    await page.getByRole('button', { name: 'Save the new password' }).click();
    await expect(page).toHaveURL(/\/admin\/login\?reset=done$/);
    await expect(page.getByText(/password changed\. sign in with the new one/i)).toBeVisible();

    await signIn(page, email, 'forgotten-password-1');
    await expect(alert(page, /invalid email or password/i)).toBeVisible();
    await signIn(page, email, 'a-brand-new-password');
    await expect(page).toHaveURL(/\/admin$/);

    // The link worked once: opening it again is a dead end, not a form.
    await page.context().clearCookies();
    await page.goto(href ?? '/');
    await expect(alert(page, /no longer works/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save the new password' })).toHaveCount(0);

    // An address that is not an admin's: the same words, and nothing sent.
    await page.goto('/admin/forgot-password');
    await page.getByLabel('Email').fill(`nobody-${randomBytes(3).toString('hex')}@example.com`);
    await page.getByRole('button', { name: 'Send a reset link' }).click();
    await expect(page.getByText(/belongs to an organizer account/i)).toBeVisible();
    await expect(page.getByTestId('exposed-reset-link')).toHaveCount(0);
  });

  test('a garbage reset token is refused', async ({ page }) => {
    await page.goto('/admin/reset-password?token=not-a-real-token');
    await page.getByLabel('New password', { exact: true }).fill('a-brand-new-password');
    await page.getByLabel('New password again', { exact: true }).fill('a-brand-new-password');
    await page.getByRole('button', { name: 'Save the new password' }).click();
    await expect(alert(page, /no longer works/i)).toBeVisible();
  });

  test('change email: needs the password, changes on the new address’s click, signs out everywhere', async ({
    page,
    request,
  }) => {
    const email = newAdmin('email-change-pass-1');
    const moved = `e2e-moved-${randomBytes(4).toString('hex')}@example.com`;
    await signIn(page, email, 'email-change-pass-1');
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/account');

    const newEmail = page.getByLabel('New email');
    const password = page.locator('#email-password');
    const send = page.getByRole('button', { name: 'Send a confirmation link' });

    await newEmail.fill(moved);
    await password.fill('not-the-password');
    await send.click();
    await expect(alert(page, /password is not right/i)).toBeVisible();
    await expect(newEmail).toHaveValue(moved);

    await password.fill('email-change-pass-1');
    await send.click();
    await expect(page.getByText(/confirmation link is on its way/i)).toBeVisible();
    await page.getByTestId('exposed-email-link').click();

    await expect(page).toHaveURL(/\/admin\/login\?email=changed$/);
    await expect(page.getByText(/email changed\. sign in with the new address/i)).toBeVisible();

    await signIn(page, email, 'email-change-pass-1');
    await expect(alert(page, /invalid email or password/i)).toBeVisible();
    await signIn(page, moved, 'email-change-pass-1');
    await expect(page).toHaveURL(/\/admin$/);

    // Over HTTP the endpoint is off: only the account page (with its password check) can do it.
    const direct = await request.post('/api/auth/change-email', {
      data: { newEmail: 'x@example.com' },
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(direct.status()).toBe(404);
  });
});
