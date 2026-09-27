'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { PUBLIC_NAV, headerTone, isPublicNavActive } from '@/lib/public-nav';

/**
 * The two parts of the header that depend on the path (decision 7). The
 * public layout persists across navigations, so the server cannot re-render
 * them; everything else in the header stays a server component and follows
 * the tone through `group-data-[tone=dark]:` variants.
 */

/** The `<header>` itself, carrying `data-tone` — dark on the home page only (N1). */
export function HeaderFrame({ className, children }: { className?: string; children: ReactNode }) {
  const tone = headerTone(usePathname());
  return (
    <header data-tone={tone} className={className}>
      {children}
    </header>
  );
}

/**
 * The four desktop links (N2). The active underline is an `::after` inset
 * shadow, not the link's own box-shadow: the focus ring (globals.css) owns
 * box-shadow and would erase it.
 */
export function SiteNavLinks() {
  const pathname = usePathname();
  return PUBLIC_NAV.map((item) => (
    <Link
      key={item.href}
      href={item.href}
      aria-current={isPublicNavActive(item, pathname) ? 'page' : undefined}
      className="relative inline-flex h-11 items-center rounded-[8px] px-3 text-base text-foreground group-data-[tone=dark]:text-[#e6e1d6] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] hover:bg-wash aria-[current=page]:font-semibold group-data-[tone=dark]:aria-[current=page]:text-[#fbfaf8] aria-[current=page]:after:shadow-[inset_0_-2px_0_var(--color-foreground)] group-data-[tone=dark]:aria-[current=page]:after:shadow-[inset_0_-2px_0_var(--color-marigold)]"
    >
      {item.label}
    </Link>
  ));
}
