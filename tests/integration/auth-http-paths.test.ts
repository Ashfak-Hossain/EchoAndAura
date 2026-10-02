import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import { buildAuthOptions, magicLinkPlugin } from '@/lib/auth-options';

// The emails are the side effect under test; catch them here instead of
// needing Redis.
const enqueue = vi.hoisted(() => ({
  signIn: vi.fn<(to: string, url: string) => Promise<void>>(async () => {}),
  account: vi.fn<(email: { kind: string; to: string }) => Promise<void>>(async () => {}),
}));
vi.mock('@/server/queue/producer', () => ({
  enqueueSignInEmail: enqueue.signIn,
  enqueueAccountEmail: enqueue.account,
}));

/**
 * ADR-048 against real Postgres: password sign-in, the magic link and the
 * reset email are reachable only through the Turnstile-checked server
 * actions. better-auth's HTTP router must 404 them (and anything else in
 * disabledPaths), while `auth.api.*` — what those actions call — still
 * works. Same instance shape as src/lib/auth.ts, minus nextCookies.
 */
const auth = betterAuth({
  ...buildAuthOptions({ disableSignUp: true }),
  plugins: [magicLinkPlugin()],
});

const baseURL = process.env.BETTER_AUTH_URL ?? '';
const origin = baseURL ? new URL(baseURL).origin : '';
const url = (path: string) => `${origin}/api/auth${path}`;

function post(path: string, body: Record<string, string>): Promise<Response> {
  return auth.handler(
    new Request(url(path), {
      method: 'POST',
      // Same-origin, like a browser on the site: the 404 must not be an
      // origin-check refusal in disguise.
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(body),
    }),
  );
}

describe('better-auth HTTP surface (Postgres)', () => {
  const adminEmail = `auth-paths-admin-${randomUUID()}@example.com`;
  const buyerEmail = `auth-paths-buyer-${randomUUID()}@example.com`;
  const password = 'correct-horse-battery-staple';

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    // Seeded the way scripts/create-admin.ts does it.
    const seedAuth = betterAuth(buildAuthOptions({ disableSignUp: false }));
    const { user } = await seedAuth.api.signUpEmail({
      body: { email: adminEmail, password, name: 'Admin' },
    });
    await db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, user.id));
  });

  afterAll(async () => {
    // Sessions and accounts cascade; a buyer row exists only if a link was used.
    await db.delete(schema.users).where(inArray(schema.users.email, [adminEmail, buyerEmail]));
    await queryClient.end();
  });

  beforeEach(() => {
    enqueue.signIn.mockClear();
    enqueue.account.mockClear();
  });

  describe('over HTTP', () => {
    it.each([
      ['/sign-in/email', { email: adminEmail, password }],
      ['/sign-in/magic-link', { email: buyerEmail }],
      ['/request-password-reset', { email: adminEmail, redirectTo: '/admin/reset-password' }],
      ['/send-verification-email', { email: adminEmail }],
      ['/change-email', { newEmail: `moved-${randomUUID()}@example.com` }],
      // ADR-049: account changes only through requireAdmin()'d actions.
      ['/reset-password', { token: 'not-a-token', newPassword: 'long-enough-password' }],
      ['/change-password', { currentPassword: password, newPassword: 'another-long-password' }],
      ['/verify-password', { password }],
      ['/update-user', { name: 'Renamed' }],
      ['/update-session', {}],
      ['/delete-user', {}],
      ['/revoke-session', { token: 'x' }],
      ['/revoke-sessions', {}],
      ['/revoke-other-sessions', {}],
      ['/link-social', { provider: 'google' }],
      ['/unlink-account', { providerId: 'credential' }],
      ['/get-access-token', { providerId: 'credential' }],
      ['/refresh-token', { providerId: 'credential' }],
      // Spellings the router might still match: none may slip past.
      ['/sign-in/email/', { email: adminEmail, password }],
      ['/SIGN-IN/EMAIL', { email: adminEmail, password }],
      ['//sign-in/email', { email: adminEmail, password }],
      ['/sign-in/%65mail', { email: adminEmail, password }],
    ])('POST %s answers 404 and sends nothing', async (path, body) => {
      const res = await post(path, body);
      expect(res.status).toBe(404);
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(enqueue.signIn).not.toHaveBeenCalled();
      expect(enqueue.account).not.toHaveBeenCalled();
    });

    // Unauthenticated, an enabled one would answer 401; 404 means disabled.
    it.each(['/list-sessions', '/list-accounts', '/account-info', '/delete-user/callback'])(
      'GET %s answers 404',
      async (path) => {
        const res = await auth.handler(new Request(url(path)));
        expect(res.status).toBe(404);
      },
    );

    // Controls: the same router and base path still serve the token links
    // in the emails and the session, so the 404s above are disabledPaths.
    it('still serves the session and the emailed token links', async () => {
      const session = await auth.handler(new Request(url('/get-session')));
      expect(session.status).toBe(200);

      const reset = await auth.handler(
        new Request(url('/reset-password/not-a-token?callbackURL=/admin/reset-password')),
      );
      expect(reset.status).toBe(302);
      expect(reset.headers.get('location')).toContain('error=INVALID_TOKEN');

      const verify = await auth.handler(new Request(url('/magic-link/verify?token=not-a-token')));
      expect(verify.status).toBe(302);
      expect(verify.headers.get('location')).toContain('error=');

      // The email-change confirmation link (ADR-038).
      const email = await auth.handler(new Request(url('/verify-email?token=not-a-token')));
      expect(email.status).not.toBe(404);
    });
  });

  describe('through auth.api (the server actions)', () => {
    it('signs the admin in with the right password', async () => {
      const res = await auth.api.signInEmail({
        body: { email: adminEmail, password },
        headers: new Headers(),
      });
      expect(res.user.email).toBe(adminEmail);
      expect(res.token).toEqual(expect.any(String));
    });

    it('refuses a wrong password as bad credentials, not as a missing endpoint', async () => {
      const err: unknown = await auth.api
        .signInEmail({
          body: { email: adminEmail, password: 'wrong-password' },
          headers: new Headers(),
        })
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(err).toBeInstanceOf(APIError);
      expect(err instanceof APIError && err.status).toBe('UNAUTHORIZED');
    });

    it('sends a buyer their magic link', async () => {
      await auth.api.signInMagicLink({ body: { email: buyerEmail }, headers: new Headers() });
      expect(enqueue.signIn).toHaveBeenCalledOnce();
      expect(enqueue.signIn.mock.calls[0]?.[0]).toBe(buyerEmail);
    });

    it('sends the admin a reset link', async () => {
      await auth.api.requestPasswordReset({
        body: { email: adminEmail, redirectTo: '/admin/reset-password' },
        headers: new Headers(),
      });
      expect(enqueue.account).toHaveBeenCalledOnce();
      expect(enqueue.account.mock.calls[0]?.[0]).toMatchObject({
        kind: 'password-reset',
        to: adminEmail,
      });
    });
  });
});
