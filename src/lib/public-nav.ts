/**
 * Public header navigation (Canvas 6, N1/N2). Shared by the desktop links
 * and the phone menu so both mark the same page current. Mirrors
 * `isNavItemActive` in src/components/admin/nav-items.ts.
 */
export interface PublicNavItem {
  label: string;
  href: string;
  /** Match child routes too: "Events" stays current on /events/<slug>. */
  prefix?: boolean;
}

export const PUBLIC_NAV: readonly PublicNavItem[] = [
  { label: 'Events', href: '/events', prefix: true },
  { label: 'Past events', href: '/archive' },
  { label: 'FAQ', href: '/faq' },
  { label: 'Contact', href: '/contact' },
];

/** No item matches '/': the home page is not "Events" (frame H1). */
export function isPublicNavActive(item: PublicNavItem, pathname: string): boolean {
  if (item.prefix) return pathname === item.href || pathname.startsWith(`${item.href}/`);
  return pathname === item.href;
}

export type HeaderTone = 'dark' | 'light';

/** The charcoal header runs into the home page's dark hero; every other page is light. */
export function headerTone(pathname: string): HeaderTone {
  return pathname === '/' ? 'dark' : 'light';
}

/**
 * What the chrome's "Get tickets" needs about the featured event (N3). Only
 * present while that event is buyable; the phone menu also names it.
 */
export interface FeaturedCta {
  slug: string;
  title: string;
  /** Pre-formatted in Dhaka on the server, e.g. "Sat 17 Oct 2026". */
  dateLabel: string;
}

export interface AccountLink {
  href: string;
  label: string;
  signedIn: boolean;
}

/** Header, phone menu and footer all offer the same account link (N1). */
export function accountLink(signedIn: boolean): AccountLink {
  return signedIn
    ? { href: '/account', label: 'My orders', signedIn }
    : { href: '/account/sign-in', label: 'Sign in', signedIn };
}
