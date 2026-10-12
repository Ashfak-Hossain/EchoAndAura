import './global.css';
import { Archivo, Geist_Mono } from 'next/font/google';
import { Providers } from '@/components/providers';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The app's faces (docs/BRAND.md): Archivo for headings, Geist Mono for code.
// Self-hosted at build; the body stays on the system stack, as in the app.
const archivo = Archivo({ subsets: ['latin'], variable: '--font-archivo', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  metadataBase: new URL('https://docs.echoandaura.com'),
  title: { default: 'Echo & Aura developer docs', template: '%s | Echo & Aura' },
  description: 'Learn how Echo & Aura handles ticket reservations, manual payments, and delivery.',
  openGraph: { siteName: 'Echo & Aura developer docs', images: '/og/site.png' },
  twitter: { card: 'summary_large_image' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
