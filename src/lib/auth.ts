import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { buildAuthOptions, magicLinkPlugin, twoFactorPlugin } from './auth-options';

/**
 * The app's better-auth instance.
 *
 * Lives in src/lib, not src/server, because nextCookies() transitively imports
 * next/headers and src/server must stay free of next/* so the worker can import
 * it. Use `auth.api.*` from server actions and server components only.
 */
export const auth = betterAuth({
  ...buildAuthOptions({ disableSignUp: true }),
  // Buyer sign-in by email link, the admin's second factor (ADR-049), then
  // nextCookies (lets server actions set/clear the session cookie and the
  // two-factor challenge cookie). nextCookies must be the last plugin.
  plugins: [magicLinkPlugin(), twoFactorPlugin(), nextCookies()],
});
