import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PublicShell, publicMetadata } from '@/components/public/public-shell';
import { WebAnalytics } from '@/components/public/web-analytics';
import { RootDocument, rootMetadata } from '../root-document';

export async function generateMetadata(): Promise<Metadata> {
  return { ...rootMetadata, ...(await publicMetadata()) };
}

/**
 * ADR-079: the root of the measured pages, the only layout that renders
 * the analytics beacon. Every page under it is on the proxy's allowlist
 * (a unit test keeps the two equal). A navigation to any page outside it
 * loads a new document, so the beacon never comes along.
 */
export default function MeasuredLayout({ children }: { children: ReactNode }) {
  return (
    <RootDocument root="measured">
      <PublicShell>{children}</PublicShell>
      <WebAnalytics />
    </RootDocument>
  );
}
