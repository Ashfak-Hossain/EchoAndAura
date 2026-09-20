/**
 * Optional public-site settings read from the environment. Each returns null
 * when unset so the UI can simply omit the element.
 */

/** The organizer's Facebook page — "Remind me on Facebook", footer link. */
export function facebookPageUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.FACEBOOK_PAGE_URL?.trim();
  return raw ? raw : null;
}

/**
 * The personal bKash number buyers send money to (A4 payment steps). Lives
 * in the environment until Settings (B14, Phase 6) gives Raj a screen for
 * it. Displayed as typed — keep it in the "01712 345678" form.
 */
export function bkashReceiveNumber(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.BKASH_RECEIVE_NUMBER?.trim();
  return raw ? raw : null;
}

/** Organizer contact shown on order pages ("Stuck? Message the organizer…"). */
export function organizerContactEmail(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.ORGANIZER_CONTACT_EMAIL?.trim();
  return raw ? raw : null;
}

/** Organizer's phone for emails and order pages ("Raj · 01712 345678"). Displayed as typed. */
export function organizerPhone(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.ORGANIZER_PHONE?.trim();
  return raw ? raw : null;
}

/**
 * Absolute origin for canonical/Open Graph URLs and every link in an email.
 * Facebook only accepts absolute `og:url` / `og:image`, so this must be the
 * real public origin in production. Falls back to the auth base URL locally.
 */
export function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.SITE_URL ?? env.BETTER_AUTH_URL;
  if (!raw) throw new Error('SITE_URL is not set — see docs/ENVIRONMENT.md');
  return raw.replace(/\/+$/, '');
}
