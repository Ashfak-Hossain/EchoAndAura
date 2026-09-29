import type { Metadata } from 'next';
import { Archivo, Geist_Mono } from 'next/font/google';
import './globals.css';
import { SITE_NAME } from '@/lib/seo';
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
