import type { Metadata } from 'next';
import { Archivo, Geist_Mono } from 'next/font/google';
import './globals.css';
import { SITE_NAME, siteUrl } from '@/lib/seo';
import { cn } from '@/lib/utils';

// S2: Archivo for display/headings; the UI body is the Helvetica system stack
// (set in globals.css, no font file); Geist Mono for codes and trxIDs.
const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-archivo',
  display: 'swap',
});
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

/**
 * Defaults every page inherits (ADR-042). Built per request: `metadataBase`
 * turns the generated share image and icons into absolute URLs, and
 * SITE_URL is only a placeholder at build time. A page that sets its own
 * `openGraph` replaces this one whole, so pages without one (About, FAQ,
 * policies) share with these defaults and the generated image.
 */
export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
    description: 'Tickets for Echo & Aura events in Dhaka.',
    applicationName: SITE_NAME,
    openGraph: { type: 'website', siteName: SITE_NAME, locale: 'en_GB' },
    twitter: { card: 'summary_large_image' },
  };
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={cn('h-full font-sans antialiased', archivo.variable, geistMono.variable)}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
