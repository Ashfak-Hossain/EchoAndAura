import { localeFromPath } from '@/i18n/locales';

/**
 * Public header navigation (Canvas 6, N1/N2). Shared by the desktop links
 * and the phone menu so both mark the same page current. Mirrors
 * `isNavItemActive` in src/components/admin/nav-items.ts.
 */
export interface PublicNavItem {
  /** The catalogue key under `nav` (ADR-061). */
  key: 'events' | 'archive' | 'faq' | 'contact';
  label: string;
  href: string;
  /** Match child routes too: "Events" stays current on /events/<slug>. */
  prefix?: boolean;
}

export const PUBLIC_NAV: readonly PublicNavItem[] = [
  { key: 'events', label: 'Events', href: '/events', prefix: true },
  { key: 'archive', label: 'Past events', href: '/archive' },
  { key: 'faq', label: 'FAQ', href: '/faq' },
  { key: 'contact', label: 'Contact', href: '/contact' },
];

/** No item matches '/': the home page is not "Events" (frame H1). `/bn/…` counts as its page (ADR-061). */
export function isPublicNavActive(item: PublicNavItem, address: string): boolean {
  const pathname = localeFromPath(address).path;
  if (item.prefix) return pathname === item.href || pathname.startsWith(`${item.href}/`);
  return pathname === item.href;
}

export type HeaderTone = 'dark' | 'light';

/** The charcoal header runs into the home page's dark hero; every other page is light. */
export function headerTone(pathname: string): HeaderTone {
  return localeFromPath(pathname).path === '/' ? 'dark' : 'light';
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
  /** The catalogue key under `shell` (ADR-061). */
  key: 'myOrders' | 'signIn';
  label: string;
  signedIn: boolean;
}

/** Header, phone menu and footer all offer the same account link (N1). */
export function accountLink(signedIn: boolean): AccountLink {
  return signedIn
    ? { href: '/account', key: 'myOrders', label: 'My orders', signedIn }
    : { href: '/account/sign-in', key: 'signIn', label: 'Sign in', signedIn };
}
