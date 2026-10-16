import type { Metadata } from 'next';
import { RootDocument, rootMetadata } from '../root-document';

/**
 * The whole admin, the sign-in and password pages included, stays out of
 * search results (ADR-042). robots.txt also disallows /admin; this covers a
 * crawler that arrives by a link anyway.
 */
export const metadata: Metadata = {
  ...rootMetadata,
  robots: { index: false, follow: false },
};

/** ADR-079: a root of its own, so a link to the public site loads a new document. */
export default function AdminRootLayout({ children }: LayoutProps<'/admin'>) {
  return <RootDocument root="admin">{children}</RootDocument>;
}
