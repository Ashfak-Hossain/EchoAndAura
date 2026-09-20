import type { BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import * as schema from '@/db/schema';
import { MAGIC_LINK_TTL_SECONDS, sendMagicLink } from '@/server/auth/magic-link';
import { enqueueSignInEmail } from '@/server/queue/producer';

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
    // better-auth's own limiter (3 sign-ins / 10 s per IP) is brute-force
    // protection for /admin/login and stays on in production. The e2e
    // build is also NODE_ENV=production (next start) but signs in as the
    // admin from six workers at once, so APP_ENV=test turns it off.
    rateLimit: {
      enabled: process.env.APP_ENV === 'test' ? false : process.env.NODE_ENV === 'production',
    },
    // Table names are plural (users, sessions, accounts, verifications) — see the
    // Auth section of src/db/schema.ts.
    database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: true }),
    user: {
      additionalFields: {
        // Read on every session; never accepted from a sign-up/update body.
        role: { type: 'string', required: false, defaultValue: 'buyer', input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp,
      requireEmailVerification: false,
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
