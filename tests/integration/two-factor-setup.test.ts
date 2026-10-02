import { createHmac, randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { splitSetCookieHeader } from 'better-auth/cookies';
import { eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import { buildAuthOptions, magicLinkPlugin, twoFactorPlugin } from '@/lib/auth-options';

/**
 * ADR-049 against real Postgres, through the setup page's own actions:
 * turning two-factor on must end every other session of that admin. The
 * flag is per account and requireAdmin() reads it live, so a session that
 * only ever gave the password (another device, one from before migration
 * 0024, one opened during the setup window) would otherwise become a full
 * console session without a code.
 *
 * The actions run with the request's cookies supplied through a mocked
 * `next/headers`, and the app's auth instance swapped for one of the same
 * shape minus nextCookies (as two-factor.test.ts does).
 */
const request = vi.hoisted(() => ({ headers: new Headers() }));

vi.mock('next/headers', () => ({ headers: async () => request.headers }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock('@/lib/auth', async () => {
  const { betterAuth: build } = await import('better-auth');
  const options = await import('@/lib/auth-options');
  return {
    auth: build({
      ...options.buildAuthOptions({ disableSignUp: true }),
      plugins: [options.magicLinkPlugin(), options.twoFactorPlugin()],
    }),
  };
});
// No email, no Redis: the limiter is off under APP_ENV=test anyway.
vi.mock('@/server/queue/producer', () => ({
  enqueueSignInEmail: vi.fn(async () => {}),
  enqueueAccountEmail: vi.fn(async () => {}),
}));
vi.mock('@/server/lib/rate-limit', () => ({
  createRateLimiter: () => ({ allow: async () => true, check: async () => true }),
  redisRateLimitStore: () => ({}),
}));
vi.mock('@/lib/request-ip', () => ({ requestIp: async () => '203.0.113.7' }));

const auth = betterAuth({
  ...buildAuthOptions({ disableSignUp: true }),
  plugins: [magicLinkPlugin(), twoFactorPlugin()],
});

const password = 'correct-horse-battery-staple';

/** The session cookie a browser would send back, from a Set-Cookie list. */
function sessionHeaders(set: Headers): Headers {
  const pairs: string[] = [];
  for (const raw of set.getSetCookie().flatMap(splitSetCookieHeader)) {
    const pair = raw.split(';')[0] ?? '';
    const name = pair.slice(0, pair.indexOf('=')).trim();
    if (name.endsWith('.session_token')) pairs.push(pair.trim());
  }
  if (pairs.length === 0) throw new Error('no session cookie set');
  return new Headers({ cookie: pairs.join('; ') });
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    value = ((value << 5) | alphabet.indexOf(char)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238, as an authenticator app computes it from the shown key. */
function totp(base32Secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac('sha1', base32Decode(base32Secret)).update(counter).digest();
  const offset = mac.readUInt8(mac.length - 1) & 0x0f;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const created: string[] = [];

async function createAdmin(label: string): Promise<{ id: string; email: string }> {
  const email = `two-factor-setup-${label}-${randomUUID()}@example.com`;
  const seedAuth = betterAuth(buildAuthOptions({ disableSignUp: false }));
  const { user } = await seedAuth.api.signUpEmail({ body: { email, password, name: 'Admin' } });
  await db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, user.id));
  // Sign-up signs in too; start each test with no session.
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
  created.push(user.id);
  return { id: user.id, email };
}

/** A password sign-in before enrolment: a plain (pending) session. */
async function signIn(email: string): Promise<Headers> {
  const res = await auth.api.signInEmail({
    body: { email, password },
    headers: new Headers(),
    returnHeaders: true,
  });
  return sessionHeaders(res.headers);
}

async function tokensOf(userId: string): Promise<string[]> {
  const rows = await db
    .select({ token: schema.sessions.token })
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, userId));
  return rows.map((r) => r.token);
}

describe('two-factor setup ends the other sessions (ADR-049, Postgres)', () => {
  beforeAll(async () => {
    vi.stubEnv('APP_ENV', 'test');
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    // Sessions, accounts and two_factors rows cascade; setup makes no
    // sign-in challenges.
    if (created.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, created));
    await queryClient.end();
  });

  it('session A (password only) is dead once session B turns two-factor on', async () => {
    const { startSetupAction, confirmSetupAction } =
      await import('@/app/admin/two-factor/setup/actions');
    const admin = await createAdmin('a-b');
    const bystander = await createAdmin('bystander');

    const sessionA = await signIn(admin.email);
    const sessionB = await signIn(admin.email);
    const bystanderSession = await signIn(bystander.email);
    const [tokensBefore, bystanderTokens] = [
      await tokensOf(admin.id),
      await tokensOf(bystander.id),
    ];
    expect(tokensBefore).toHaveLength(2);
    // Both are pending sessions: the setup page is all either can reach.
    for (const h of [sessionA, sessionB]) {
      expect((await auth.api.getSession({ headers: h }))?.user).toMatchObject({
        twoFactorEnabled: false,
      });
    }

    // B goes through the setup page.
    request.headers = sessionB;
    const started = await startSetupAction({}, form({ password }));
    expect(started.error).toBeUndefined();
    const secret = started.setup?.secret ?? '';
    const confirmed = await confirmSetupAction({}, form({ code: totp(secret) }));
    expect(confirmed).toEqual({ done: true });

    // Two-factor is on for the account; A never gave a code, so A is gone,
    // not upgraded. B's old cookie is gone too (better-auth rotated it).
    expect(await auth.api.getSession({ headers: sessionB })).toBeNull();
    expect(await auth.api.getSession({ headers: sessionA })).toBeNull();
    const tokensAfter = await tokensOf(admin.id);
    expect(tokensAfter).toHaveLength(1);
    // The one left is the new session better-auth made for B on success.
    expect(tokensBefore).not.toContain(tokensAfter[0]);
    const [user] = await db
      .select({ on: schema.users.twoFactorEnabled })
      .from(schema.users)
      .where(eq(schema.users.id, admin.id));
    expect(user?.on).toBe(true);

    // Another admin is untouched.
    expect(await tokensOf(bystander.id)).toEqual(bystanderTokens);
    expect(await auth.api.getSession({ headers: bystanderSession })).not.toBeNull();
  });

  it('A, now dead, cannot use the setup actions either: they send it to sign in', async () => {
    const { startSetupAction, confirmSetupAction } =
      await import('@/app/admin/two-factor/setup/actions');
    const admin = await createAdmin('late');
    const sessionA = await signIn(admin.email);
    const sessionB = await signIn(admin.email);

    request.headers = sessionB;
    const started = await startSetupAction({}, form({ password }));
    expect(await confirmSetupAction({}, form({ code: totp(started.setup?.secret ?? '') }))).toEqual(
      { done: true },
    );

    request.headers = sessionA;
    await expect(startSetupAction({}, form({ password }))).rejects.toThrow('redirect /admin/login');
  });
});
