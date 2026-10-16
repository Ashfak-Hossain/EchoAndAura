/**
 * ADR-077, ADR-079: Cloudflare Web Analytics — cookieless visit counts.
 *
 * The beacon is rendered by the (measured) root layout and nowhere else,
 * with the request's CSP nonce: Cloudflare's automatic injection is off,
 * because our CSP would block an injected script. Once loaded, it stays
 * for the life of the document and reports every in-app navigation, so
 * the measured pages are a root layout of their own: Next.js loads a new
 * document for any navigation out of it (ADR-079).
 *
 * The proxy keeps this allowlist for `connect-src`: only a measured page
 * may send reports. A unit test keeps it equal to the routes under
 * `(measured)/`. Pages whose address is an access key (tickets, orders),
 * the register page that leads to an order, and signed-in pages are
 * never on it.
 */

/** The beacon script, loaded with the page's nonce. */
export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';

/** Where the beacon sends its reports (connect-src). */
export const BEACON_REPORT_ORIGIN = 'https://cloudflareinsights.com';

/**
 * The measured routes, whole: the pages under `(measured)/`. `/events/<slug>`
 * but not its register page, which redirects into `/orders/<uuid>`.
 */
const MEASURED_ROUTES = [
  /^\/$/,
  /^\/(events|archive|about|faq|contact|privacy|refund|terms)$/,
  /^\/events\/[^/]+$/,
];

/** The site token from env, or null when unset or not 32 hex characters. */
export function webAnalyticsToken(raw: string | undefined): string | null {
  const token = raw?.trim().toLowerCase();
  return token && /^[0-9a-f]{32}$/.test(token) ? token : null;
}

/** Whether a page is measured. Takes the English route (after the `/bn` rewrite). */
export function isMeasuredPath(pathname: string): boolean {
  return MEASURED_ROUTES.some((route) => route.test(pathname));
}

/** The nonce in a CSP header built by `buildCsp`, or null. */
export function nonceFromCsp(csp: string | null): string | null {
  return /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp ?? '')?.[1] ?? null;
}

/** The beacon's `data-cf-beacon` value. `spa` counts in-app navigations. */
export function beaconConfig(token: string): string {
  return JSON.stringify({ token, spa: true });
}
