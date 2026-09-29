import type { Metadata } from 'next';

/**
 * The whole admin, the sign-in and password pages included, stays out of
 * search results (ADR-042). robots.txt also disallows /admin; this covers a
 * crawler that arrives by a link anyway.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: LayoutProps<'/admin'>) {
  return children;
}
