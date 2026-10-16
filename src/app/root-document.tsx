import type { Metadata } from 'next';
import { Archivo, Geist_Mono, Noto_Sans_Bengali } from 'next/font/google';
import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import './globals.css';
import { SITE_NAME } from '@/lib/seo';
import { cn } from '@/lib/utils';

// S2: Archivo for display/headings; the UI body is the Helvetica system stack
// (set in globals.css, no font file); Geist Mono for codes and trxIDs.
const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-archivo-face',
  display: 'swap',
});
// ADR-061: Bangla letters on /bn pages (self-hosted at build, like the
// others: no request to Google at runtime). Not preloaded: English pages
// never use it, and the browser fetches it only when a Bangla glyph shows.
const bangla = Noto_Sans_Bengali({
  subsets: ['bengali'],
  variable: '--font-bangla',
  display: 'swap',
  preload: false,
});
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

/**
 * What every root layout starts from. Static on purpose: anything built
 * from the site URL (metadataBase, the share image) lives in the public
 * shell, which renders per request (ADR-042).
 */
export const rootMetadata: Metadata = {
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: 'Tickets for Echo & Aura events in Dhaka.',
  applicationName: SITE_NAME,
};

/**
 * ADR-079: the <html> and <body> of every root layout. The app has four
 * roots: (measured), (public), admin and door, plus global-not-found.
 * Next.js loads a new document whenever a navigation crosses from one
 * root to another, which is what keeps the analytics beacon of a measured
 * page out of every other page.
 *
 * `data-root` names the root that rendered the page, so the e2e suite can
 * tell the global 404 from a group's: if Next ever served an unknown URL
 * from the (measured) root, it would carry the beacon.
 */
export async function RootDocument({
  root,
  children,
}: {
  root: 'measured' | 'public' | 'admin' | 'door' | 'global';
  children: ReactNode;
}) {
  // ADR-061: the proxy's locale header (`bn` on /bn pages, else `en`).
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      data-root={root}
      className={cn(
        'h-full font-sans antialiased',
        archivo.variable,
        geistMono.variable,
        bangla.variable,
      )}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
