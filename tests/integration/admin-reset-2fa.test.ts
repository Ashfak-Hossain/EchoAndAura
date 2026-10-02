import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { count, eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import { buildAuthOptions, twoFactorPlugin } from '@/lib/auth-options';
import { adminAccountsRepository } from '@/server/repositories/admin-accounts.repository';

/**
 * ADR-049 against real Postgres: the lost-phone recovery. After
 * `admin:reset-2fa` the old secret, backup codes and every session are
 * gone, and the next password sign-in gets a session straight away (the
 * console then forces setup) instead of a code challenge. Same plugin as
 * src/lib/auth.ts, minus nextCookies.
 */
const auth = betterAuth({
  ...buildAuthOptions({ disableSignUp: true }),
  plugins: [twoFactorPlugin()],
});
const seedAuth = betterAuth(buildAuthOptions({ disableSignUp: false }));

const password = 'correct-horse-battery-staple';

async function createUser(email: string, role: 'admin' | 'buyer'): Promise<string> {
  const { user } = await seedAuth.api.signUpEmail({ body: { email, password, name: 'Someone' } });
  await db.update(schema.users).set({ role }).where(eq(schema.users.id, user.id));
  return user.id;
}

/** A user as the plugin leaves them after setup, mid-lockout for good measure. */
async function enableTwoFactor(userId: string): Promise<void> {
  await db.update(schema.users).set({ twoFactorEnabled: true }).where(eq(schema.users.id, userId));
  await db.insert(schema.twoFactors).values({
    id: randomUUID(),
    secret: 'old-encrypted-secret',
    backupCodes: 'old-encrypted-backup-codes',
    userId,
    verified: true,
    failedVerificationCount: 7,
    lockedUntil: new Date(Date.now() + 15 * 60_000),
  });
}

async function sessionCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, userId));
  return row?.n ?? 0;
}

async function twoFactorState(userId: string) {
  const [user] = await db
    .select({ enabled: schema.users.twoFactorEnabled })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  const rows = await db
    .select({ id: schema.twoFactors.id })
    .from(schema.twoFactors)
    .where(eq(schema.twoFactors.userId, userId));
  return { enabled: user?.enabled, rows: rows.length };
}

async function signIn(email: string): Promise<Record<string, unknown>> {
  const result: unknown = await auth.api.signInEmail({ body: { email, password } });
  if (typeof result !== 'object' || result === null) throw new Error('No sign-in result');
  return { ...result };
}

/** Runs the script as production does (a separate process), never throwing. */
function runScript(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'node_modules/.bin/tsx',
      ['scripts/admin-reset-2fa.ts', ...args],
      { env: process.env },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

describe('admin two-factor reset (Postgres)', () => {
  const tag = randomUUID();
  const lostPhone = `reset-2fa-lost-${tag}@example.com`;
  const bystander = `reset-2fa-other-${tag}@example.com`;
  const viaScript = `reset-2fa-script-${tag}@example.com`;
  const buyer = `reset-2fa-buyer-${tag}@example.com`;
  const never = `reset-2fa-never-${tag}@example.com`;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    for (const email of [lostPhone, bystander, viaScript]) {
      ids[email] = await createUser(email, 'admin');
      // A live session (say, on the lost phone) before 2FA is turned on.
      await signIn(email);
      await enableTwoFactor(ids[email]);
    }
    ids[buyer] = await createUser(buyer, 'buyer');
    ids[never] = await createUser(never, 'admin');
    await signIn(buyer);
  });

  afterAll(async () => {
    // Sign-in challenges (value = user id) and their attempt counters don't
    // cascade: clear them as two-factor.test.ts does.
    const userIds = Object.values(ids);
    const challenges = await db
      .select({ identifier: schema.verifications.identifier })
      .from(schema.verifications)
      .where(inArray(schema.verifications.value, userIds));
    const identifiers = challenges.flatMap(({ identifier }) => [
      identifier,
      `2fa-attempts-${identifier}`,
    ]);
    if (identifiers.length > 0) {
      await db
        .delete(schema.verifications)
        .where(inArray(schema.verifications.identifier, identifiers));
    }
    // Sessions, accounts and two_factors rows cascade.
    await db
      .delete(schema.users)
      .where(inArray(schema.users.email, [lostPhone, bystander, viaScript, buyer, never]));
    await queryClient.end();
  });

  it('wipes the secret and every session, so the next sign-in skips the code', async () => {
    const userId = ids[lostPhone];
    // Before: the password alone only earns a code challenge.
    const challenged = await signIn(lostPhone);
    expect(challenged.twoFactorRedirect).toBe(true);
    expect(challenged.token).toBeUndefined();

    const sessionsBefore = await sessionCount(userId);
    expect(sessionsBefore).toBeGreaterThan(0);

    const result = await adminAccountsRepository.resetTwoFactor(userId);

    expect(result).toEqual({ sessionsRevoked: sessionsBefore });
    expect(await sessionCount(userId)).toBe(0);
    expect(await twoFactorState(userId)).toEqual({ enabled: false, rows: 0 });

    // After: a plain session, which requireAdmin() sends to the setup page.
    const signedIn = await signIn(lostPhone);
    expect(signedIn.twoFactorRedirect).toBeUndefined();
    expect(typeof signedIn.token).toBe('string');

    // Another admin is untouched.
    expect(await twoFactorState(ids[bystander])).toEqual({ enabled: true, rows: 1 });
    expect(await sessionCount(ids[bystander])).toBeGreaterThan(0);
  });

  it('finds users by email and is harmless on an account without 2FA', async () => {
    expect(await adminAccountsRepository.findByEmail(buyer)).toEqual({
      id: ids[buyer],
      email: buyer,
      role: 'buyer',
    });
    expect(await adminAccountsRepository.findByEmail(`nobody-${tag}@example.com`)).toBeNull();

    // An admin who never finished setup: nothing to delete, no error.
    await adminAccountsRepository.resetTwoFactor(ids[never]);
    expect(await twoFactorState(ids[never])).toEqual({ enabled: false, rows: 0 });
    expect(await sessionCount(ids[never])).toBe(0);
  });

  describe('the script', () => {
    it('resets an admin by email, any case and spacing', async () => {
      const run = await runScript(`  ${viaScript.toUpperCase()} `);

      expect(run.code).toBe(0);
      expect(run.stdout.trim()).toBe(
        `Two-factor reset for ${viaScript}. They must set it up again at their next sign-in.`,
      );
      expect(await twoFactorState(ids[viaScript])).toEqual({ enabled: false, rows: 0 });
      expect(await sessionCount(ids[viaScript])).toBe(0);
    });

    it('refuses a buyer, who has no two-factor to reset', async () => {
      const sessionsBefore = await sessionCount(ids[buyer]);
      expect(sessionsBefore).toBeGreaterThan(0);
      const run = await runScript(buyer);

      expect(run.code).toBe(1);
      expect(run.stderr).toContain(`${buyer} is not an admin`);
      expect(await sessionCount(ids[buyer])).toBe(sessionsBefore);
    });

    it('exits non-zero for an unknown email', async () => {
      const unknown = `nobody-${tag}@example.com`;
      const run = await runScript(unknown);

      expect(run.code).toBe(1);
      expect(run.stderr).toContain(`No user with email ${unknown}`);
    });

    it('prints the usage without an email', async () => {
      const run = await runScript();

      expect(run.code).toBe(1);
      expect(run.stderr).toContain('Usage: pnpm admin:reset-2fa <email>');
    });
  });
});
