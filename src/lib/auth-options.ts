import type { BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink, twoFactor } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import * as schema from '@/db/schema';
import { CLOUDFLARE_RANGES } from '@/lib/client-ip';
import { NEW_PASSWORD_MIN, PASSWORD_MAX } from '@/lib/validation/auth';
import {
  EMAIL_CHANGE_TTL_SECONDS,
  PASSWORD_RESET_TTL_SECONDS,
  sendNewEmailConfirmation,
  sendPasswordReset,
} from '@/server/auth/account-emails';
import { MAGIC_LINK_TTL_SECONDS, sendMagicLink } from '@/server/auth/magic-link';
import { enqueueAccountEmail, enqueueSignInEmail } from '@/server/queue/producer';
import { adminAccountsRepository } from '@/server/repositories/admin-accounts.repository';

export interface BuildAuthOptionsInput {
  /**
   * Reject password sign-ups. The app always runs with `true` (there is
   * exactly one admin); `scripts/create-admin.ts` uses `false` once to seed
   * that admin through the public API. Buyers never get a password: they
   * sign in with a magic link, which creates their account on first use.
   */
  disableSignUp: boolean;
}

export const ROLES = ['admin', 'buyer'] as const;
export type Role = (typeof ROLES)[number];

async function lookupRole(email: string): Promise<string | null> {
  // better-auth lowercases on user lookup/creation but hands sendMagicLink
  // the address as typed; match the stored (lowercased) row either way.
  const [row] = await db
    .select({ role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.email, email.trim().toLowerCase()))
    .limit(1);
  return row?.role ?? null;
}

/**
 * Shared better-auth configuration.
 *
 * Deliberately free of any Next.js import so it can be used both by the app
 * (`src/lib/auth.ts`, which adds the nextCookies plugin) and by scripts that run
 * outside a request scope. Keeping it here rather than in `src/server/` is what
 * preserves the "no next/* in src/server" rule — business logic never imports
 * auth; it receives the acting user as a parameter.
 */
export function buildAuthOptions({ disableSignUp }: BuildAuthOptionsInput): BetterAuthOptions {
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;

  // Fail loudly at boot rather than run with a guessable session secret.
  if (!secret || secret.length < 32 || secret.startsWith('replace_with')) {
    throw new Error(
      'BETTER_AUTH_SECRET must be set to a real value of at least 32 characters ' +
        '(openssl rand -base64 32) — see docs/ENVIRONMENT.md',
    );
  }
  if (!baseURL) {
    throw new Error('BETTER_AUTH_URL is not set — see docs/ENVIRONMENT.md');
  }

  return {
    secret,
    baseURL,
    // better-auth's own limiter runs only in its HTTP router (auth.api
    // skips it; the server actions throttle themselves). It guards what is
    // still public there — token links, session, sign-out — and stays on
    // in production. The e2e build is also NODE_ENV=production (next start)
    // but drives one IP from six workers at once, so APP_ENV=test turns it off.
    rateLimit: {
      enabled: process.env.APP_ENV === 'test' ? false : process.env.NODE_ENV === 'production',
    },
    // A disabled path 404s in better-auth's HTTP router only; `auth.api.*`
    // calls the endpoint directly, so the server actions keep working.
    disabledPaths: [
      // ADR-038: the account page is the only way to change an email,
      // because it checks the current password first.
      '/change-email',
      // ADR-048: password sign-in, the magic link and the reset email are
      // reached only through the Turnstile-checked, throttled server
      // actions. Open over HTTP, a bot would post here and skip both.
      // The links in the emails stay open: /magic-link/verify,
      // /reset-password/:token (which hands the token to our reset page)
      // and /verify-email (the email-change confirmation).
      '/sign-in/email',
      '/sign-in/magic-link',
      '/request-password-reset',
      // Unused (the email change sends its own link) and would mail an
      // unverified account — the seeded admin — on anyone's request.
      '/send-verification-email',
      // ADR-049: every two-factor step runs through a server action with
      // our own throttle; `/send-otp` and `/verify-otp` (email codes) are
      // not configured at all.
      '/two-factor/enable',
      '/two-factor/disable',
      '/two-factor/get-totp-uri',
      '/two-factor/verify-totp',
      '/two-factor/verify-backup-code',
      '/two-factor/generate-backup-codes',
      '/two-factor/send-otp',
      '/two-factor/verify-otp',
      // ADR-049: every other account change is a server action that checks
      // requireAdmin() (and so the second factor) first. Over HTTP these
      // would only need a session cookie, which an admin who hasn't
      // finished two-factor setup also has. Reads (/get-session) and
      // /sign-out stay.
      '/reset-password',
      '/change-password',
      '/verify-password',
      '/update-user',
      '/update-session',
      '/delete-user',
      '/delete-user/callback',
      '/list-sessions',
      '/list-accounts',
      '/account-info',
      '/revoke-session',
      '/revoke-sessions',
      '/revoke-other-sessions',
      '/link-social',
      '/unlink-account',
      '/get-access-token',
      '/refresh-token',
    ],
    // Table names are plural (users, sessions, accounts, verifications) — see the
    // Auth section of src/db/schema.ts.
    database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: true }),
    // ADR-037: behind Cloudflare → Traefik, X-Forwarded-For always has two
    // or more entries. Without trusted proxies better-auth resolves no IP
    // from such a header and rate-limits its HTTP routes in one bucket shared
    // by the whole internet (anyone could keep them locked). With Cloudflare's
    // ranges it reads from the right, like requestIp().
    advanced: {
      ipAddress: { trustedProxies: [...CLOUDFLARE_RANGES] },
    },
    user: {
      additionalFields: {
        // Read on every session; never accepted from a sign-up/update body.
        role: { type: 'string', required: false, defaultValue: 'buyer', input: false },
      },
      changeEmail: { enabled: true },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp,
      requireEmailVerification: false,
      // New passwords only (sign-up, reset, change); sign-in never checks it.
      minPasswordLength: NEW_PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
      resetPasswordTokenExpiresIn: PASSWORD_RESET_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) =>
        sendPasswordReset(
          { email: user.email, url },
          { roleOf: lookupRole, enqueue: enqueueAccountEmail },
        ),
    },
    // Used only by the admin email change (ADR-038): no sign-up
    // verification, and buyers verify by magic link. `user.email` here is
    // the address being moved to.
    emailVerification: {
      sendOnSignUp: false,
      expiresIn: EMAIL_CHANGE_TTL_SECONDS,
      sendVerificationEmail: ({ user, url }) =>
        sendNewEmailConfirmation(
          { newEmail: user.email, role: (user as { role?: unknown }).role, url },
          { enqueue: enqueueAccountEmail },
        ),
      // The email moved: sign the account out everywhere, including the
      // browser that clicked (better-auth just gave it a session). The owner
      // signs in again with the new address.
      afterEmailVerification: async (user) => {
        await adminAccountsRepository.revokeAllSessions(user.id);
      },
    },
  };
}

/**
 * The buyer sign-in plugin, built separately so `betterAuth()` sees the
 * concrete plugin type (and `auth.api.signInMagicLink` exists) — inside
 * the widened `BetterAuthOptions` it would be erased.
 */
export function magicLinkPlugin() {
  return magicLink({
    expiresIn: MAGIC_LINK_TTL_SECONDS,
    sendMagicLink: (data) =>
      sendMagicLink(
        { email: data.email, url: data.url },
        { roleOf: lookupRole, enqueue: enqueueSignInEmail },
      ),
  });
}

/** What authenticator apps list the account under. */
export const TWO_FACTOR_ISSUER = 'echoandaura';
export const BACKUP_CODE_COUNT = 10;

/**
 * ADR-049: authenticator-app codes (TOTP) for admins, with one-time backup
 * codes. Built separately for the same reason as magicLinkPlugin: so
 * `auth.api.verifyTOTP` and friends keep their concrete types.
 *
 * No email codes (`otpOptions`): email is the account-recovery channel,
 * so it must not also be the second factor. No trusted devices: a session
 * already lasts about a week, and a long-lived cookie that skips the code
 * is one more thing to steal. better-auth itself gives each sign-in
 * challenge 5 tries and locks the account for 15 minutes after 10 wrong
 * codes in a row.
 */
export function twoFactorPlugin() {
  return twoFactor({
    issuer: TWO_FACTOR_ISSUER,
    backupCodeOptions: { amount: BACKUP_CODE_COUNT, storeBackupCodes: 'encrypted' },
  });
}
