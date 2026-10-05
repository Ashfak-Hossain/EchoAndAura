import type { Metadata } from 'next';
import { Archivo, Geist_Mono, Noto_Sans_Bengali } from 'next/font/google';
import { getLocale } from 'next-intl/server';
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
 * Static on purpose: this also covers any page Next prerenders at build
 * (today only its global error page, ADR-043), where SITE_URL is only a
 * placeholder. Anything built from the site URL (metadataBase, the share
 * image) lives in the public layout, which renders per request (ADR-042).
 */
export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: 'Tickets for Echo & Aura events in Dhaka.',
  applicationName: SITE_NAME,
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // ADR-061: the proxy's locale header (`bn` on /bn pages, else `en`).
  const locale = await getLocale();
  return (
    <html
      lang={locale}
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
