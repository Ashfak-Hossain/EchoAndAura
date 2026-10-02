import { expect, test, type Page } from './test';
import {
  createAdmin,
  newBackupCodes,
  signInAsAdmin,
  submitCode,
  submitPassword,
  totpForBase32,
  totpForSecret,
} from './fixtures/admin';

/**
 * ADR-049: two-factor sign-in for every admin. Each test makes its own
 * admin (the shared one is never touched): seeded with the suite's
 * test-only secret, or with none at all, as a new account starts. The
 * suite works out the authenticator codes itself (fixtures/admin-credentials.ts).
 */

const VERIFY_URL = /\/admin\/login\/verify$/;
const SETUP_URL = /\/admin\/two-factor\/setup$/;
const WRONG_CODE = /that code is not right/i;

const alert = (page: Page, text: RegExp) => page.getByRole('alert').filter({ hasText: text });

/** A 6-digit code that is not valid now (nor one step either side). */
function wrongCode(codeAt: (at: number) => string): string {
  const now = Date.now();
  const valid = new Set([-30_000, 0, 30_000].map((d) => codeAt(now + d)));
  let n = 0;
  while (valid.has(String(n).padStart(6, '0'))) n++;
  return String(n).padStart(6, '0');
}

async function useBackupCode(page: Page, code: string) {
  await page.getByRole('button', { name: 'Use a backup code instead' }).click();
  await page.getByLabel('Backup code').fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();
}

test.describe('admin two-factor (ADR-049)', () => {
  test('the password alone is not enough: a wrong code is refused, the right one signs in', async ({
    page,
  }) => {
    const admin = await createAdmin({ prefix: 'e2e-2fa' });
    await submitPassword(page, admin.email, admin.password);
    await expect(page).toHaveURL(VERIFY_URL, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Two-factor sign-in' })).toBeVisible();

    // Between the two steps there is no session: the console is still shut.
    // (A fresh tab, so this page keeps its sign-in challenge.)
    const other = await page.context().newPage();
    await other.goto('/admin/orders');
    await expect(other).toHaveURL(/\/admin\/login$/);
    await other.close();

    await submitCode(
      page,
      wrongCode((at) => totpForSecret(admin.totpSecret, at)),
    );
    await expect(alert(page, WRONG_CODE)).toBeVisible();
    await expect(page).toHaveURL(VERIFY_URL);

    await submitCode(page, totpForSecret(admin.totpSecret));
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
    await expect(page.getByText(`Signed in as ${admin.email}`)).toBeVisible();

    // The verify page is a dead end once signed in, and without a challenge.
    await page.goto('/admin/login/verify');
    await expect(page).toHaveURL(/\/admin$/);
    await page.context().clearCookies();
    await page.goto('/admin/login/verify');
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test('a backup code signs in once; the next one still works', async ({ page }) => {
    const backupCodes = newBackupCodes();
    const admin = await createAdmin({ prefix: 'e2e-2fa-backup', backupCodes });

    await submitPassword(page, admin.email, admin.password);
    await expect(page).toHaveURL(VERIFY_URL, { timeout: 20_000 });
    await useBackupCode(page, backupCodes[0]!);
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });

    await page.context().clearCookies();
    await submitPassword(page, admin.email, admin.password);
    await expect(page).toHaveURL(VERIFY_URL, { timeout: 20_000 });
    await useBackupCode(page, backupCodes[0]!);
    await expect(alert(page, WRONG_CODE)).toBeVisible();

    // Same form, still in backup mode: the second code works.
    await page.getByLabel('Backup code').fill(backupCodes[1]!);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
  });

  test('five wrong codes spend the sign-in: the sixth, even right, goes back to the password and says why', async ({
    page,
  }) => {
    const admin = await createAdmin({ prefix: 'e2e-2fa-spent' });
    await submitPassword(page, admin.email, admin.password);
    await expect(page).toHaveURL(VERIFY_URL, { timeout: 20_000 });
    const wrong = wrongCode((at) => totpForSecret(admin.totpSecret, at));
    for (let i = 0; i < 5; i++) {
      await submitCode(page, wrong);
      await expect(alert(page, WRONG_CODE)).toBeVisible();
    }
    await submitCode(page, totpForSecret(admin.totpSecret));
    await expect(page).toHaveURL(/\/admin\/login\?expired=attempts$/, { timeout: 20_000 });
    await expect(alert(page, /too many wrong codes for this sign-in/i)).toBeVisible();
    await expect(page.getByText(/timed out/i)).toHaveCount(0);
  });

  test('an admin without two-factor is held at setup, from any admin page, and can sign out', async ({
    page,
  }) => {
    const admin = await createAdmin({ prefix: 'e2e-2fa-none', twoFactor: false });
    await submitPassword(page, admin.email, admin.password);
    await expect(page).toHaveURL(SETUP_URL, { timeout: 20_000 });

    for (const path of ['/admin', '/admin/orders', '/admin/settings', '/admin/account']) {
      await page.goto(path);
      await expect(page).toHaveURL(SETUP_URL);
    }

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto('/admin/two-factor/setup');
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test('setup: QR and key, a code from the app turns it on, 10 backup codes, then every sign-in asks', async ({
    page,
    browser,
  }) => {
    const admin = await createAdmin({ prefix: 'e2e-2fa-setup', twoFactor: false });
    // Another device signed in with the password alone, parked at setup.
    const otherDevice = await browser.newContext();
    const other = await otherDevice.newPage();
    await submitPassword(other, admin.email, admin.password);
    await expect(other).toHaveURL(SETUP_URL, { timeout: 20_000 });

    await submitPassword(page, admin.email, admin.password);
    await expect(page).toHaveURL(SETUP_URL, { timeout: 20_000 });

    // Step 1: the password again (a borrowed, signed-in laptop is not enough).
    await page.getByLabel('Current password').fill('not-the-password');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(alert(page, /password is not right/i)).toBeVisible();
    await page.getByLabel('Current password').fill(admin.password);
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 2: what the phone scans, and the same key as text.
    await expect(
      page.getByRole('img', { name: 'QR code for your authenticator app' }),
    ).toBeVisible();
    const key = (await page.getByTestId('totp-secret').textContent())!.trim();
    expect(key).toMatch(/^[A-Z2-7]+$/);
    // Step 1 again makes a new secret: an older entry in the app must go.
    await expect(page.getByText(/delete that entry in the app first/i)).toBeVisible();

    await page.getByLabel('Code from the app').fill(wrongCode((at) => totpForBase32(key, at)));
    await page.getByRole('button', { name: 'Turn on two-factor' }).click();
    await expect(alert(page, WRONG_CODE)).toBeVisible();

    await page.getByLabel('Code from the app').fill(totpForBase32(key));
    await page.getByRole('button', { name: 'Turn on two-factor' }).click();

    // Step 3: the codes, shown once.
    const codes = page.getByTestId('backup-codes').getByRole('listitem');
    await expect(codes).toHaveCount(10, { timeout: 20_000 });
    const backupCodes = await codes.allTextContents();
    for (const code of backupCodes) expect(code.trim()).toMatch(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/);
    // The codes exist only on this page: leaving it (reload, back) asks
    // first, and the page says where to make new ones.
    await expect(page.getByText(/make new ones on your account/i)).toBeVisible();
    const leaveBlocked = () =>
      page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
    expect(await leaveBlocked()).toBe(true);
    await page.getByRole('button', { name: 'I have saved these codes' }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
    await expect(page.getByText(`Signed in as ${admin.email}`)).toBeVisible();
    expect(await leaveBlocked()).toBe(false);

    // The other device never gave a code: turning two-factor on ended its
    // session rather than upgrading it.
    await other.goto('/admin');
    await expect(other).toHaveURL(/\/admin\/login$/);
    await otherDevice.close();

    // From now on the password leads to the code page, and the new key's code gets in.
    await page.context().clearCookies();
    await submitPassword(page, admin.email, admin.password);
    await expect(page).toHaveURL(VERIFY_URL, { timeout: 20_000 });
    await submitCode(page, totpForBase32(key));
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });

    // And a code from step 3 works as a backup code.
    await page.context().clearCookies();
    await submitPassword(page, admin.email, admin.password);
    await expect(page).toHaveURL(VERIFY_URL, { timeout: 20_000 });
    await useBackupCode(page, backupCodes[0]!.trim());
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
  });

  test('your account: new backup codes need the password, and replace the old ones', async ({
    page,
  }) => {
    const oldCodes = newBackupCodes();
    const admin = await createAdmin({ prefix: 'e2e-2fa-codes', backupCodes: oldCodes });
    await signInAsAdmin(page, admin);
    await page.goto('/admin/account');

    const password = page.locator('#codes-password');
    const make = page.getByRole('button', { name: 'Make new backup codes' });
    await password.fill('not-the-password');
    await make.click();
    await expect(alert(page, /password is not right/i)).toBeVisible();

    await password.fill(admin.password);
    await make.click();
    await expect(page.getByText(/new backup codes made/i)).toBeVisible();
    const codes = page.getByTestId('backup-codes').getByRole('listitem');
    await expect(codes).toHaveCount(10);
    const newCodes = (await codes.allTextContents()).map((c) => c.trim());
    expect(newCodes.some((c) => oldCodes.includes(c))).toBe(false);
    // At 320px each code stays on one line ("Ab3dE-" over "xfGh2" reads
    // as two codes when copied by hand).
    await page.setViewportSize({ width: 320, height: 800 });
    const lineCounts = await codes.evaluateAll((items) =>
      items.map((li) => {
        const range = document.createRange();
        range.selectNodeContents(li);
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      }),
    );
    expect(lineCounts).toEqual(Array(10).fill(1));
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('backup-codes')).toHaveCount(0);

    // An old code is dead; a new one gets in.
    await page.context().clearCookies();
    await submitPassword(page, admin.email, admin.password);
    await expect(page).toHaveURL(VERIFY_URL, { timeout: 20_000 });
    await useBackupCode(page, oldCodes[0]!);
    await expect(alert(page, WRONG_CODE)).toBeVisible();
    await page.getByLabel('Backup code').fill(newCodes[0]!);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
  });
});
