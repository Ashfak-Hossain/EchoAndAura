import { createHmac, randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { splitSetCookieHeader } from 'better-auth/cookies';
import { count, eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import {
  BACKUP_CODE_COUNT,
  TWO_FACTOR_ISSUER,
  buildAuthOptions,
  magicLinkPlugin,
  twoFactorPlugin,
} from '@/lib/auth-options';
import { backupCodeSchema, totpCodeSchema } from '@/lib/validation/auth';

// No email is under test; keep the instance off Redis.
vi.mock('@/server/queue/producer', () => ({
  enqueueSignInEmail: vi.fn(async () => {}),
  enqueueAccountEmail: vi.fn(async () => {}),
}));

/**
 * ADR-049 against real Postgres: a correct password alone never yields a
 * session for an admin with two-factor on. Same instance shape as
 * src/lib/auth.ts, minus nextCookies; cookies are carried between calls by
 * hand, the way a browser would.
 */
const auth = betterAuth({
  ...buildAuthOptions({ disableSignUp: true }),
  plugins: [magicLinkPlugin(), twoFactorPlugin()],
});

const password = 'correct-horse-battery-staple';

/** A browser's cookie store, reduced to what these tests need. */
class CookieJar {
  private readonly live = new Map<string, string>();
  /** Every value ever set, expired or not: what a client that ignores expiry would send. */
  private readonly everSet = new Map<string, string>();

  take(headers: Headers): void {
    for (const raw of headers.getSetCookie().flatMap(splitSetCookieHeader)) {
      const [pair = '', ...attributes] = raw.split(';');
      const at = pair.indexOf('=');
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const expired = value === '' || attributes.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a));
      if (expired) {
        this.live.delete(name);
      } else {
        this.live.set(name, value);
        this.everSet.set(`${name}=${value}`, name);
      }
    }
  }

  headers(): Headers {
    return cookieHeader([...this.live].map(([name, value]) => `${name}=${value}`));
  }

  /** Sends back every cookie the server ever set, ignoring its expiries. */
  stubbornHeaders(): Headers {
    return cookieHeader([...this.everSet.keys()]);
  }

  names(): string[] {
    return [...this.live.keys()];
  }
}

function cookieHeader(pairs: string[]): Headers {
  return new Headers(pairs.length > 0 ? { cookie: pairs.join('; ') } : {});
}

const isSessionCookie = (name: string) => name.endsWith('.session_token');
const isChallengeCookie = (name: string) => name.endsWith('.two_factor');

// RFC 6238 written out here rather than taken from better-auth, so the
// codes come from the same maths an authenticator app runs on the base32
// secret in the QR code — not from the code under test.
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`not base32: ${char}`);
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(key: Buffer, step = 0): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + step));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = mac.readUInt8(mac.length - 1) & 0x0f;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

/** Six digits that no nearby time step accepts (the server allows ±1). */
function wrongCode(key: Buffer): string {
  const near = new Set([-2, -1, 0, 1, 2].map((step) => totp(key, step)));
  let n = Number(totp(key));
  let code: string;
  do {
    n = (n + 1) % 1_000_000;
    code = n.toString().padStart(6, '0');
  } while (near.has(code));
  return code;
}

interface Refusal {
  status: unknown;
  code: unknown;
}

async function refusal(call: Promise<unknown>): Promise<Refusal> {
  const err: unknown = await call.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(err instanceof APIError)) throw new Error(`expected an APIError, got ${String(err)}`);
  return { status: err.status, code: err.body?.code };
}

interface Admin {
  id: string;
  email: string;
}

const created: Admin[] = [];

async function createAdmin(label: string): Promise<Admin> {
  const email = `two-factor-${label}-${randomUUID()}@example.com`;
  // Seeded the way scripts/create-admin.ts does it.
  const seedAuth = betterAuth(buildAuthOptions({ disableSignUp: false }));
  const { user } = await seedAuth.api.signUpEmail({ body: { email, password, name: 'Admin' } });
  await db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, user.id));
  const admin = { id: user.id, email };
  created.push(admin);
  return admin;
}

async function signIn(admin: Admin) {
  const jar = new CookieJar();
  const res = await auth.api.signInEmail({
    body: { email: admin.email, password },
    headers: new Headers(),
    returnHeaders: true,
  });
  jar.take(res.headers);
  const body: unknown = res.response;
  return { jar, body };
}

interface Enrolment {
  key: Buffer;
  base32Secret: string;
  backupCodes: string[];
}

type EnableResult = { method: 'otp' } | { method: 'totp'; totpURI: string; backupCodes: string[] };

/** We only ever enable TOTP; email codes (`otp`) are not configured. */
function totpSetup(result: EnableResult): { totpURI: string; backupCodes: string[] } {
  if (result.method !== 'totp') throw new Error('enableTwoFactor returned no TOTP setup');
  return result;
}

/** The base32 secret in the QR code, as the setup page shows it for manual entry. */
function secretOf(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get('secret');
  if (!secret) throw new Error(`no secret in ${totpURI}`);
  return secret;
}

/** The setup page's flow: password → QR code → first correct code. */
async function enrol(admin: Admin): Promise<Enrolment> {
  const { jar } = await signIn(admin);
  const enabled = await auth.api.enableTwoFactor({
    body: { password },
    headers: jar.headers(),
    returnHeaders: true,
  });
  jar.take(enabled.headers);
  const { totpURI, backupCodes } = totpSetup(enabled.response);
  const base32Secret = secretOf(totpURI);
  const key = base32Decode(base32Secret);

  const confirmed = await auth.api.verifyTOTP({
    body: { code: totp(key) },
    headers: jar.headers(),
    returnHeaders: true,
  });
  jar.take(confirmed.headers);
  // Signed out, as the tests below start from the login page.
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, admin.id));
  return { key, base32Secret, backupCodes };
}

async function sessionCount(admin: Admin): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, admin.id));
  return row?.n ?? 0;
}

async function twoFactorRow(admin: Admin) {
  const [row] = await db
    .select()
    .from(schema.twoFactors)
    .where(eq(schema.twoFactors.userId, admin.id));
  if (!row) throw new Error(`no two_factors row for ${admin.email}`);
  return row;
}

async function userRow(admin: Admin) {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, admin.id));
  if (!row) throw new Error(`no user ${admin.email}`);
  return row;
}

describe('admin two-factor (ADR-049, Postgres)', () => {
  // One admin per scenario: the lockout counter is per account, so the
  // burn and lockout tests must not share one.
  let admin: Admin;
  let enrolment: Enrolment;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    admin = await createAdmin('main');
    enrolment = await enrol(admin);
  });

  afterAll(async () => {
    const ids = created.map((a) => a.id);
    if (ids.length > 0) {
      // Pending sign-in challenges hold the user id as their value; each
      // has an attempts counter keyed by its identifier.
      const challenges = await db
        .select({ identifier: schema.verifications.identifier })
        .from(schema.verifications)
        .where(inArray(schema.verifications.value, ids));
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
      await db.delete(schema.users).where(inArray(schema.users.id, ids));
    }
    await queryClient.end();
  });

  it('enrols: a 10-code set and a QR secret under our issuer', async () => {
    expect(enrolment.backupCodes).toHaveLength(BACKUP_CODE_COUNT);
    expect(new Set(enrolment.backupCodes).size).toBe(BACKUP_CODE_COUNT);
    // The verify page's own validation must accept what better-auth issues.
    for (const code of enrolment.backupCodes) {
      expect(backupCodeSchema.safeParse(code).success, code).toBe(true);
    }
    expect(totpCodeSchema.safeParse(totp(enrolment.key)).success).toBe(true);
    expect((await userRow(admin)).twoFactorEnabled).toBe(true);
    expect((await twoFactorRow(admin)).verified).toBe(true);
  });

  it('(a) the right password alone gives a challenge, never a session', async () => {
    expect(await sessionCount(admin)).toBe(0);
    const { jar, body } = await signIn(admin);

    expect(body).toEqual({ twoFactorRedirect: true, twoFactorMethods: ['totp'] });
    expect(jar.names().some(isChallengeCookie)).toBe(true);
    expect(jar.names().some(isSessionCookie)).toBe(false);
    expect(await auth.api.getSession({ headers: jar.headers() })).toBeNull();
    // Even a client that ignores the cookie expiry holds a dead token: the
    // session row better-auth made for the password step is gone.
    expect(await auth.api.getSession({ headers: jar.stubbornHeaders() })).toBeNull();
    expect(await sessionCount(admin)).toBe(0);
  });

  it('(b) the challenge plus the current code signs in, once', async () => {
    const { jar } = await signIn(admin);
    const challenge = jar.headers();

    const ok = await auth.api.verifyTOTP({
      body: { code: totp(enrolment.key) },
      headers: challenge,
      returnHeaders: true,
    });
    jar.take(ok.headers);

    const session = await auth.api.getSession({ headers: jar.headers() });
    expect(session?.user).toMatchObject({ email: admin.email, twoFactorEnabled: true });
    expect(jar.names().some(isChallengeCookie)).toBe(false);
    expect(await sessionCount(admin)).toBe(1);

    // The challenge is single-use: replaying it gets nothing.
    expect(
      await refusal(
        auth.api.verifyTOTP({ body: { code: totp(enrolment.key) }, headers: challenge }),
      ),
    ).toMatchObject({ code: 'INVALID_TWO_FACTOR_COOKIE' });
    expect(await sessionCount(admin)).toBe(1);

    await db.delete(schema.sessions).where(eq(schema.sessions.userId, admin.id));
  });

  it('(b) a code needs a challenge: without one, nothing to verify', async () => {
    expect(
      await refusal(
        auth.api.verifyTOTP({ body: { code: totp(enrolment.key) }, headers: new Headers() }),
      ),
    ).toMatchObject({ status: 'UNAUTHORIZED', code: 'INVALID_TWO_FACTOR_COOKIE' });
    expect(await sessionCount(admin)).toBe(0);
  });

  it('(c) five wrong codes burn the challenge, even for the right code after', async () => {
    const burner = await createAdmin('burn');
    const { key, backupCodes } = await enrol(burner);
    const { jar } = await signIn(burner);

    for (let i = 0; i < 5; i++) {
      expect(
        await refusal(
          auth.api.verifyTOTP({ body: { code: wrongCode(key) }, headers: jar.headers() }),
        ),
        `wrong code ${i + 1}`,
      ).toMatchObject({ status: 'UNAUTHORIZED', code: 'INVALID_CODE' });
    }
    expect(
      await refusal(auth.api.verifyTOTP({ body: { code: totp(key) }, headers: jar.headers() })),
    ).toMatchObject({ code: 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE' });
    // Gone for good, for either factor.
    expect(
      await refusal(auth.api.verifyTOTP({ body: { code: totp(key) }, headers: jar.headers() })),
    ).toMatchObject({ code: 'INVALID_TWO_FACTOR_COOKIE' });
    expect(
      await refusal(
        auth.api.verifyBackupCode({ body: { code: backupCodes[0] ?? '' }, headers: jar.headers() }),
      ),
    ).toMatchObject({ code: 'INVALID_TWO_FACTOR_COOKIE' });
    expect(await sessionCount(burner)).toBe(0);

    // Five is a burnt challenge, not a locked account: a new sign-in works.
    expect((await twoFactorRow(burner)).lockedUntil).toBeNull();
    const again = await signIn(burner);
    const ok = await auth.api.verifyTOTP({
      body: { code: totp(key) },
      headers: again.jar.headers(),
      returnHeaders: true,
    });
    again.jar.take(ok.headers);
    expect(await auth.api.getSession({ headers: again.jar.headers() })).not.toBeNull();
    // A success clears the consecutive-failure count.
    expect((await twoFactorRow(burner)).failedVerificationCount).toBe(0);
  });

  it('(d) ten wrong codes in a row lock the account for 15 minutes, right code or not', async () => {
    const locked = await createAdmin('lock');
    const { key, backupCodes } = await enrol(locked);

    // Two challenges of five: the lock counts across challenges.
    for (let round = 0; round < 2; round++) {
      const { jar } = await signIn(locked);
      for (let i = 0; i < 5; i++) {
        expect(
          await refusal(
            auth.api.verifyTOTP({ body: { code: wrongCode(key) }, headers: jar.headers() }),
          ),
        ).toMatchObject({ code: 'INVALID_CODE' });
      }
    }

    const row = await twoFactorRow(locked);
    expect(row.failedVerificationCount).toBe(10);
    expect(row.lockedUntil).not.toBeNull();
    const lockMs = (row.lockedUntil?.getTime() ?? 0) - Date.now();
    expect(lockMs).toBeGreaterThan(14 * 60_000);
    expect(lockMs).toBeLessThanOrEqual(15 * 60_000);

    // A fresh challenge (the password still works) cannot get past the
    // lock with the right code or with a backup code.
    const { jar } = await signIn(locked);
    expect(
      await refusal(auth.api.verifyTOTP({ body: { code: totp(key) }, headers: jar.headers() })),
    ).toMatchObject({ status: 'TOO_MANY_REQUESTS', code: 'ACCOUNT_TEMPORARILY_LOCKED' });
    expect(
      await refusal(
        auth.api.verifyBackupCode({ body: { code: backupCodes[0] ?? '' }, headers: jar.headers() }),
      ),
    ).toMatchObject({ code: 'ACCOUNT_TEMPORARILY_LOCKED' });
    expect(await sessionCount(locked)).toBe(0);

    // Once the 15 minutes pass (simulated), the same challenge and the
    // right code get in, and the counter starts over.
    await db
      .update(schema.twoFactors)
      .set({ lockedUntil: new Date(Date.now() - 1_000) })
      .where(eq(schema.twoFactors.userId, locked.id));
    const ok = await auth.api.verifyTOTP({
      body: { code: totp(key) },
      headers: jar.headers(),
      returnHeaders: true,
    });
    jar.take(ok.headers);
    expect(await auth.api.getSession({ headers: jar.headers() })).not.toBeNull();
    expect(await twoFactorRow(locked)).toMatchObject({
      failedVerificationCount: 0,
      lockedUntil: null,
    });
  });

  it('(e) a backup code signs in once; reused, it is refused', async () => {
    const [first = '', second = ''] = enrolment.backupCodes;

    const { jar } = await signIn(admin);
    const ok = await auth.api.verifyBackupCode({
      body: { code: first },
      headers: jar.headers(),
      returnHeaders: true,
    });
    jar.take(ok.headers);
    expect(await auth.api.getSession({ headers: jar.headers() })).not.toBeNull();
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, admin.id));

    const retry = await signIn(admin);
    expect(
      await refusal(
        auth.api.verifyBackupCode({ body: { code: first }, headers: retry.jar.headers() }),
      ),
    ).toMatchObject({ status: 'UNAUTHORIZED', code: 'INVALID_BACKUP_CODE' });
    expect(await sessionCount(admin)).toBe(0);

    // Only that one code is spent; the challenge survives one wrong try.
    const next = await auth.api.verifyBackupCode({
      body: { code: second },
      headers: retry.jar.headers(),
      returnHeaders: true,
    });
    retry.jar.take(next.headers);
    expect(await auth.api.getSession({ headers: retry.jar.headers() })).not.toBeNull();
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, admin.id));
  });

  describe('(f) over HTTP', () => {
    const baseURL = process.env.BETTER_AUTH_URL ?? '';
    const origin = baseURL ? new URL(baseURL).origin : '';

    it.each([
      '/two-factor/enable',
      '/two-factor/disable',
      '/two-factor/get-totp-uri',
      '/two-factor/verify-totp',
      '/two-factor/verify-backup-code',
      '/two-factor/generate-backup-codes',
      '/two-factor/send-otp',
      '/two-factor/verify-otp',
      // Server-only endpoints have no route at all.
      '/two-factor/generate-totp',
      '/two-factor/view-backup-codes',
      // Spellings the router might still match: none may slip past.
      '/two-factor/verify-totp/',
      '/TWO-FACTOR/VERIFY-TOTP',
      '//two-factor/verify-totp',
      '/two-factor/verify-%74otp',
    ])('POST %s answers 404, even with a live challenge and the right code', async (path) => {
      // A real challenge cookie and a valid code: if the route answered,
      // this request would sign in. It must not get that far.
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, admin.id));
      const { jar } = await signIn(admin);
      const cookie = jar.headers().get('cookie') ?? '';
      const res = await auth.handler(
        new Request(`${origin}/api/auth${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin, cookie },
          body: JSON.stringify({
            code: totp(enrolment.key),
            password,
            userId: admin.id,
            secret: enrolment.base32Secret,
          }),
        }),
      );
      expect(res.status).toBe(404);
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(await sessionCount(admin)).toBe(0);
    });
  });

  it('(g) the secret and backup codes are stored encrypted', async () => {
    const row = await twoFactorRow(admin);
    const plainSecret = enrolment.key.toString('utf8');

    expect(row.secret).not.toContain(plainSecret);
    expect(row.secret).not.toContain(enrolment.base32Secret);
    expect(row.secret.toLowerCase()).not.toContain(enrolment.base32Secret.toLowerCase());
    // Not JSON either: an encrypted blob, not a readable list.
    expect(row.backupCodes.startsWith('[')).toBe(false);
    for (const code of enrolment.backupCodes) {
      expect(row.backupCodes).not.toContain(code);
      expect(row.backupCodes).not.toContain(code.replace('-', ''));
    }
  });

  it('(h) an admin without two-factor gets a plain session; enabling alone changes nothing', async () => {
    const fresh = await createAdmin('fresh');

    // No second factor yet: the password signs in. requireAdmin() is what
    // sends this session to /admin/two-factor/setup.
    const first = await signIn(fresh);
    expect(first.body).toMatchObject({ redirect: false, user: { email: fresh.email } });
    expect(first.body).not.toHaveProperty('twoFactorRedirect');
    const session = await auth.api.getSession({ headers: first.jar.headers() });
    expect(session?.user).toMatchObject({ email: fresh.email, twoFactorEnabled: false });

    // Enabling needs the current password.
    expect(
      await refusal(
        auth.api.enableTwoFactor({
          body: { password: 'not-the-password' },
          headers: first.jar.headers(),
        }),
      ),
    ).toMatchObject({ code: 'INVALID_PASSWORD' });

    // Step 2 shown (QR code and backup codes), but no code confirmed yet.
    const enabled = await auth.api.enableTwoFactor({
      body: { password },
      headers: first.jar.headers(),
      returnHeaders: true,
    });
    first.jar.take(enabled.headers);
    const { totpURI } = totpSetup(enabled.response);
    expect(totpURI).toContain(`issuer=${TWO_FACTOR_ISSUER}`);
    expect((await userRow(fresh)).twoFactorEnabled).toBe(false);
    expect((await twoFactorRow(fresh)).verified).toBe(false);

    // A wrong confirmation code leaves it off.
    const key = base32Decode(secretOf(totpURI));
    expect(
      await refusal(
        auth.api.verifyTOTP({ body: { code: wrongCode(key) }, headers: first.jar.headers() }),
      ),
    ).toMatchObject({ code: 'INVALID_CODE' });
    expect((await userRow(fresh)).twoFactorEnabled).toBe(false);

    // Still a plain password sign-in, and no challenge can be started
    // against the unconfirmed secret.
    const second = await signIn(fresh);
    expect(second.body).not.toHaveProperty('twoFactorRedirect');
    expect(second.jar.names().some(isChallengeCookie)).toBe(false);

    // The right code turns it on and rotates the session: the old cookie
    // is dead, the new one carries twoFactorEnabled.
    const before = first.jar.headers();
    const confirmed = await auth.api.verifyTOTP({
      body: { code: totp(key) },
      headers: first.jar.headers(),
      returnHeaders: true,
    });
    first.jar.take(confirmed.headers);
    expect((await userRow(fresh)).twoFactorEnabled).toBe(true);
    expect((await twoFactorRow(fresh)).verified).toBe(true);
    expect(await auth.api.getSession({ headers: before })).toBeNull();
    expect((await auth.api.getSession({ headers: first.jar.headers() }))?.user).toMatchObject({
      twoFactorEnabled: true,
    });

    // From now on the password alone is not enough.
    const third = await signIn(fresh);
    expect(third.body).toEqual({ twoFactorRedirect: true, twoFactorMethods: ['totp'] });
  });
});
