import './global.css';
import { Providers } from '@/components/providers';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  metadataBase: new URL('https://docs.echoandaura.com'),
  title: { default: 'Echo & Aura developer docs', template: '%s | Echo & Aura' },
  description: 'Learn how Echo & Aura handles ticket reservations, manual payments, and delivery.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
