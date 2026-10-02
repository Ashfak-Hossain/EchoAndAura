import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { expect, type Page } from '../test';
import { e2eAppDatabaseUrl, e2eDatabaseUrl } from '../prepare-db';
import {
  type AdminCredentials,
  E2E_ADMIN,
  E2E_TOTP_SECRET,
  enableTwoFactor,
  totpForSecret,
} from './admin-credentials';

export {
  type AdminCredentials,
  E2E_ADMIN,
  newBackupCodes,
  totpForBase32,
  totpForSecret,
} from './admin-credentials';

/**
 * The one way the suite signs an admin in (ADR-049): password, then the
 * authenticator code it works out from the seeded secret. The shared admin
 * by default; specs that change an account make their own with
 * `createAdmin()`.
 */
export async function signInAsAdmin(page: Page, admin: AdminCredentials = E2E_ADMIN) {
  await submitPassword(page, admin.email, admin.password);
  // Six workers share one Node process; a PDF render elsewhere can hold the
  // event loop for seconds, so each sign-in step gets a realistic budget.
  await expect(page).toHaveURL(/\/admin\/login\/verify$/, { timeout: 20_000 });
  await submitCode(page, totpForSecret(admin.totpSecret));
  await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
}

/** Step 1 alone: the login form, submitted. Where it lands is the caller's to check. */
export async function submitPassword(page: Page, email: string, password: string) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
}

/** Step 2 alone: an authenticator code on the verify page. */
export async function submitCode(page: Page, code: string) {
  await page.getByLabel('Authentication code').fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();
}

/**
 * A fresh admin through the real create-admin script (as the app role, like
 * the worker in production), so a spec that changes an account never
 * touches the shared one. `twoFactor: false` leaves it as a new account is
 * on day one: sent to setup at first sign-in.
 */
export async function createAdmin(
  opts: { prefix?: string; password?: string; twoFactor?: boolean; backupCodes?: string[] } = {},
): Promise<AdminCredentials> {
  const email = `${opts.prefix ?? 'e2e-admin'}-${randomBytes(4).toString('hex')}@example.com`;
  const password = opts.password ?? `pw-${randomBytes(8).toString('hex')}`;
  execFileSync('pnpm', ['exec', 'tsx', 'scripts/create-admin.ts', email, password, 'E2E Admin'], {
    env: { ...process.env, DATABASE_URL: e2eAppDatabaseUrl() },
    stdio: 'pipe',
  });
  if (opts.twoFactor ?? true) {
    const sql = postgres(e2eDatabaseUrl(), { max: 1 });
    try {
      await enableTwoFactor(sql, email, { backupCodes: opts.backupCodes });
    } finally {
      await sql.end();
    }
  }
  return { email, password, totpSecret: E2E_TOTP_SECRET };
}
