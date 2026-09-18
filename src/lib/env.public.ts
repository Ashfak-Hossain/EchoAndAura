/**
 * Optional public-site settings read from the environment. Each returns null
 * when unset so the UI can simply omit the element.
 */

/** The organizer's Facebook page — "Remind me on Facebook", footer link. */
export function facebookPageUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.FACEBOOK_PAGE_URL?.trim();
  return raw ? raw : null;
}
