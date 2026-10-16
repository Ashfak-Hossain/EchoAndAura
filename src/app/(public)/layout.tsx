import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PublicShell, publicMetadata } from '@/components/public/public-shell';
import { RootDocument, rootMetadata } from '../root-document';

export async function generateMetadata(): Promise<Metadata> {
  return { ...rootMetadata, ...(await publicMetadata()) };
}

/**
 * ADR-079: the root of the public pages that are never measured: the
 * register form, orders, tickets and the account. The same shell as
 * (measured), and never the analytics beacon.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <RootDocument root="public">
      <PublicShell>{children}</PublicShell>
    </RootDocument>
  );
}
