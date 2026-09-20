import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { buildAuthOptions, magicLinkPlugin } from './auth-options';

/**
 * The app's better-auth instance.
 *
 * Lives in src/lib, not src/server, because nextCookies() transitively imports
 * next/headers and src/server must stay free of next/* so the worker can import
 * it. Use `auth.api.*` from server actions and server components only.
 */
export const auth = betterAuth({
  ...buildAuthOptions({ disableSignUp: true }),
  // Buyer sign-in by email link, then nextCookies (lets server actions
  // set/clear the session cookie). nextCookies must be the last plugin.
  plugins: [magicLinkPlugin(), nextCookies()],
});
