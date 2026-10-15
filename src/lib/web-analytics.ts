/**
 * ADR-077: Cloudflare Web Analytics — cookieless visit counts.
 *
 * The proxy decides, per request, whether the page is measured, and tells
 * the public layout through a request header it always sets or removes
 * itself. The layout also checks the header against the token in env: a
 * path the proxy skips still renders the not-found page with the visitor's
 * own headers. The layout
 * renders the beacon with the request's CSP nonce: Cloudflare's automatic
 * injection is off, because our CSP would block an injected script.
 *
 * Measured pages are an allowlist of whole routes, so a new route is
 * unmeasured until it is added here. Pages whose address is an access key
 * (tickets, orders), the register page that leads to an order, and
 * signed-in pages are never on it.
 *
 * Once loaded, the beacon stays for the life of the document and reports
 * the path of every in-app navigation, and the current path when the tab
 * is hidden. So a page that has it must never hand over to an unmeasured
 * page without a full page load: `needsFullLoad` decides, and the guard
 * next to the beacon acts on link clicks.
 */

import { localeFromPath } from '@/i18n/locales';

/** Request header the proxy uses to hand the token to the public layout. */
export const WEB_ANALYTICS_HEADER = 'x-ea-web-analytics';

/** The beacon script, loaded with the page's nonce. */
export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';

/** Where the beacon sends its reports (connect-src). */
export const BEACON_REPORT_ORIGIN = 'https://cloudflareinsights.com';

/**
 * The measured routes, whole. `/events/<slug>` but not its register page:
 * the register form redirects into `/orders/<uuid>` without a page load,
 * and the beacon would go with it.
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

/**
 * Whether following `href` from a page with the beacon must be a full page
 * load: it stays on our site and lands on a page that is not measured.
 * Judged by the English route, as the proxy does, so `/bn/tickets/…` is
 * not measured either.
 */
export function needsFullLoad(href: string, currentUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(href, currentUrl);
  } catch {
    return false;
  }
  if (url.origin !== new URL(currentUrl).origin) return false;
  return !isMeasuredPath(localeFromPath(url.pathname).path);
}

/** The parts of a click the guard reads. A `MouseEvent` fits. */
export interface GuardedClick {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** The link that was clicked: its resolved `href`, `target`, and whether it downloads. */
export interface GuardedLink {
  href: string;
  target: string;
  download: boolean;
}

/**
 * Whether the guard turns this click into a full page load. Only a plain
 * click the app would have handled in-app, on a link to an unmeasured page
 * of ours. A new tab, a modified click or a download is the browser's: the
 * new document loads without the beacon anyway.
 */
export function takeOverClick(
  click: GuardedClick,
  link: GuardedLink | null,
  currentUrl: string,
): boolean {
  if (!link || click.defaultPrevented || click.button !== 0) return false;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false;
  if ((link.target && link.target !== '_self') || link.download) return false;
  return needsFullLoad(link.href, currentUrl);
}

/** The nonce in a CSP header built by `buildCsp`, or null. */
export function nonceFromCsp(csp: string | null): string | null {
  return /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp ?? '')?.[1] ?? null;
}

/** The beacon's `data-cf-beacon` value. `spa` counts in-app navigations. */
export function beaconConfig(token: string): string {
  return JSON.stringify({ token, spa: true });
}
