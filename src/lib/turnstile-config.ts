import { siteUrl } from '@/lib/env.public';

/**
 * ADR-048: Cloudflare Turnstile on the public forms. Shared by the widget
 * (client), the server-side check and the pages, so it imports nothing
 * that can't ship to a browser.
 */

/**
 * One Turnstile `action` per form. Siteverify echoes it back and the
 * server checks it, so a token solved on one form can't be spent on
 * another.
 */
export const TURNSTILE_ACTIONS = [
  'register',
  'find-order',
  'buyer-sign-in',
  'admin-login',
  'password-reset',
] as const;
export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[number];

/** The hidden input the widget adds to its form. */
export const TURNSTILE_RESPONSE_FIELD = 'cf-turnstile-response';

/** Siteverify's limit; anything longer is not a token. */
export const TURNSTILE_TOKEN_MAX = 2048;

/**
 * Cloudflare's published test keys: this site key always passes and
 * issues `XXXX.DUMMY.TOKEN.XXXX`, which only the test secret accepts
 * (real secrets reject it). Dev, the e2e suite and the load stack run on
 * them.
 */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';
export const TURNSTILE_TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';
export const TURNSTILE_DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/** Every Cloudflare test key starts with 1x, 2x or 3x followed by zeros. */
const TEST_KEY = /^[123]x0{8,}/;

export interface TurnstileConfig {
  siteKey: string;
  secretKey: string;
  /**
   * The host a real token must have been solved on. Null on test keys:
   * their siteverify answers name neither our host nor the form's action,
   * so the verifier skips both claims.
   */
  expectedHostname: string | null;
}

/** Deployed environments must run on real keys (same set as image-config). */
const DEPLOYED_APP_ENVS = new Set(['staging', 'production']);

/**
 * Read at request time, not build time: images are built with placeholder
 * env (ADR-036), so the site key reaches the page as a prop.
 *
 * Deployed without keys, or with test keys, it throws instead of quietly
 * running with no bot check — a test secret accepts the dummy token that
 * anyone can send.
 */
export function readTurnstileConfig(env: NodeJS.ProcessEnv = process.env): TurnstileConfig {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() || '';
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim() || '';
  const deployed = DEPLOYED_APP_ENVS.has(env.APP_ENV ?? '');

  if (deployed) {
    if (!siteKey || !secretKey) {
      throw new Error(
        `TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be set for ${env.APP_ENV} — see docs/ENVIRONMENT.md § Bot check`,
      );
    }
    if (TEST_KEY.test(siteKey) || TEST_KEY.test(secretKey)) {
      throw new Error(
        `Turnstile test keys are not allowed in ${env.APP_ENV} — they accept a public dummy token`,
      );
    }
  }

  const resolvedSecret = secretKey || TURNSTILE_TEST_SECRET_KEY;
  return {
    siteKey: siteKey || TURNSTILE_TEST_SITE_KEY,
    secretKey: resolvedSecret,
    expectedHostname: TEST_KEY.test(resolvedSecret) ? null : new URL(siteUrl(env)).hostname,
  };
}
