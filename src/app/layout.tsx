import type { Metadata } from 'next';
import { Archivo, Geist_Mono } from 'next/font/google';
import './globals.css';
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

export const metadata: Metadata = {
  title: { default: 'echoandaura', template: '%s · echoandaura' },
  description: 'Tickets for Echo & Aura events in Dhaka.',
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
