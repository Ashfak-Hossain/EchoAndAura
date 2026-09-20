import Link from 'next/link';
import type { ReactNode } from 'react';
import { facebookPageUrl } from '@/lib/env.public';

/**
 * Public site chrome (canvas 2). Header: 72px on desktop, wordmark → home,
 * nav links only for routes that exist (Archive joins with its slice).
 * Footer: the A7 pages, then the utility row.
 */
const FOOTER_LINKS = [
  { href: '/about', label: 'About' },
  { href: '/faq', label: 'FAQ' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/refund', label: 'Refund policy' },
  { href: '/contact', label: 'Contact' },
] as const;

export function SiteShell({
  children,
  session,
}: {
  children: ReactNode;
  /** Buyer session, when signed in; the admin never uses the public chrome. */
  session?: { email: string } | null;
}) {
  const facebook = facebookPageUrl();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4 lg:h-18 lg:px-12">
        <Link href="/" className="font-heading text-lg font-semibold tracking-tight lg:text-[22px]">
          echoandaura
        </Link>
        <nav aria-label="Site" className="flex items-center gap-5 text-[15px] lg:gap-7">
          <Link href="/" className="hover:underline">
            Events
          </Link>
          <Link href="/faq" className="hidden hover:underline sm:inline">
            FAQ
          </Link>
          <Link href="/contact" className="hidden hover:underline sm:inline">
            Contact
          </Link>
          {session ? (
            <Link href="/account" className="hover:underline">
              My orders
            </Link>
          ) : (
            <Link href="/account/sign-in" className="hover:underline">
              Sign in
            </Link>
          )}
          {facebook ? (
            <a
              href={facebook}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent-ink hover:underline"
            >
              Facebook
            </a>
          ) : null}
        </nav>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
      <footer className="border-t border-border px-4 py-8 text-sm text-muted-foreground lg:px-12">
        <nav
          aria-label="Site pages"
          className="mx-auto mb-4 flex max-w-290 flex-wrap gap-x-6 gap-y-2 border-b border-border pb-4"
        >
          {FOOTER_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:underline">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="mx-auto flex max-w-290 flex-wrap items-center justify-between gap-3">
          <span>© {new Date().getFullYear()} echoandaura</span>
          <Link href="/orders/find" className="hover:underline">
            Find my order
          </Link>
          {facebook ? (
            <a href={facebook} target="_blank" rel="noreferrer" className="hover:underline">
              Facebook
            </a>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
