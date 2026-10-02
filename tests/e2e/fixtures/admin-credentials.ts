import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { symmetricEncrypt } from 'better-auth/crypto';
import type postgres from 'postgres';

/**
 * ADR-049: every admin signs in with a password and an authenticator code.
 * The suite plays the phone: the seeded admins share one TEST-ONLY TOTP
 * secret, stored the way better-auth stores it, so a spec can work out the
 * current code itself.
 *
 * No Playwright import here: prepare-db.ts (and through it
 * playwright.config.ts) uses this file too.
 */

export interface AdminCredentials {
  email: string;
  password: string;
  /** better-auth's raw TOTP secret; the HMAC key is its UTF-8 bytes. */
  totpSecret: string;
}

/** Test-only; never a real account's. 32 characters, like better-auth's own. */
export const E2E_TOTP_SECRET = 'e2e-only-totp-secret-not-for-use';

export const E2E_ADMIN: AdminCredentials = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'correct-horse-battery',
  totpSecret: E2E_TOTP_SECRET,
};

/**
 * RFC 6238 (HMAC-SHA1, 30 s, 6 digits), what authenticator apps and
 * better-auth compute. Written out rather than imported from
 * `@better-auth/utils/otp`, which is not a direct dependency; a code made
 * outside better-auth is also the stronger proof that the real thing works.
 */
export function totpCode(key: Buffer, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const value = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, '0');
}

/** The code for a raw better-auth secret (a seeded admin). */
export function totpForSecret(secret: string, at = Date.now()): string {
  return totpCode(Buffer.from(secret, 'utf8'), at);
}

/** The code for the key the setup page shows (base32, as typed into an app). */
export function totpForBase32(key: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of key.replace(/[\s=]/g, '').toUpperCase()) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error(`not base32: ${ch}`);
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? [];
  return totpCode(Buffer.from(bytes), at);
}

/** Ten codes in better-auth's shape (5 + dash + 5). */
export function newBackupCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const raw = randomBytes(10).toString('hex').slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/**
 * Turns two-factor on for an existing user, as a finished setup would:
 * secret and backup codes encrypted with BETTER_AUTH_SECRET exactly as
 * better-auth's twoFactor plugin does (`storeBackupCodes: 'encrypted'`), the
 * lockout counters cleared. The e2e server must run with the same
 * BETTER_AUTH_SECRET (it inherits this process's environment).
 */
export async function enableTwoFactor(
  sql: postgres.Sql,
  email: string,
  opts: { secret?: string; backupCodes?: string[] } = {},
): Promise<void> {
  const key = process.env.BETTER_AUTH_SECRET;
  if (!key) throw new Error('BETTER_AUTH_SECRET must be set to seed two-factor');
  const secret = await symmetricEncrypt({ key, data: opts.secret ?? E2E_TOTP_SECRET });
  const backupCodes = await symmetricEncrypt({
    key,
    data: JSON.stringify(opts.backupCodes ?? newBackupCodes()),
  });
  const [user] = await sql<{ id: string }[]>`select id from users where email = ${email}`;
  if (!user) throw new Error(`no user ${email}`);
  await sql`
    insert into two_factors (id, secret, backup_codes, user_id, verified)
    values (${randomUUID()}, ${secret}, ${backupCodes}, ${user.id}, true)
    on conflict (user_id) do update set
      secret = excluded.secret, backup_codes = excluded.backup_codes, verified = true,
      failed_verification_count = 0, locked_until = null`;
  await sql`update users set two_factor_enabled = true where id = ${user.id}`;
}
