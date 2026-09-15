import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { buildAuthOptions } from './auth-options';

/**
 * The app's better-auth instance.
 *
 * Lives in src/lib, not src/server, because nextCookies() transitively imports
 * next/headers and src/server must stay free of next/* so the worker can import
 * it. Use `auth.api.*` from server actions and server components only.
 */
export const auth = betterAuth({
  ...buildAuthOptions({ disableSignUp: true }),
  // Lets server actions set/clear the session cookie after signInEmail/signOut.
  // Must be the last plugin.
  plugins: [nextCookies()],
});
