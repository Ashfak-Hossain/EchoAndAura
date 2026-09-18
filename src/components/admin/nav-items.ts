/**
 * B2 sidebar. Items whose routes don't exist yet render disabled (no dead
 * links) — the roadmap stays visible to Raj without lying about what works.
 * Only Verification will ever carry a count (Phase 4): a badge on every
 * item trains people to ignore badges.
 */
export interface NavItem {
  label: string;
  href: string;
  /** Set when the route is not built yet; rendered as a muted, non-link item. */
  disabled?: boolean;
  /** Match child routes too (e.g. /admin/events/…). */
  prefix?: boolean;
}

export const ADMIN_NAV: readonly NavItem[] = [
  { label: 'Dashboard', href: '/admin' },
  { label: 'Events', href: '/admin/events', prefix: true },
  { label: 'Verification', href: '/admin/verification', disabled: true },
  { label: 'Orders', href: '/admin/orders', disabled: true },
  { label: 'Promo codes', href: '/admin/promo-codes', disabled: true },
  { label: 'Reports', href: '/admin/reports', disabled: true },
  { label: 'Settings', href: '/admin/settings', disabled: true },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.prefix) return pathname === item.href || pathname.startsWith(`${item.href}/`);
  return pathname === item.href;
}
