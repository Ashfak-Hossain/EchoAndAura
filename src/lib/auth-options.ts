import type { BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@/db/client';
import * as schema from '@/db/schema';

export interface BuildAuthOptionsInput {
  /**
   * Reject sign-ups. The app always runs with `true` (there is exactly one
   * admin and no public registration); `scripts/create-admin.ts` uses `false`
   * once to seed that admin through the public API.
   */
  disableSignUp: boolean;
}

/**
 * Shared better-auth configuration.
 *
 * Deliberately free of any Next.js import so it can be used both by the app
 * (`src/lib/auth.ts`, which adds the nextCookies plugin) and by scripts that run
 * outside a request scope. Keeping it here rather than in `src/server/` is what
 * preserves the "no next/* in src/server" rule — business logic never imports
 * auth; it receives the acting admin as a parameter.
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
    // Table names are plural (users, sessions, accounts, verifications) — see the
    // Auth section of src/db/schema.ts.
    database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: true }),
    emailAndPassword: {
      enabled: true,
      disableSignUp,
      // No email provider is wired yet (Phase 4); the seeded admin is trusted.
      requireEmailVerification: false,
    },
  };
}
