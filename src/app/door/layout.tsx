import type { Metadata, Viewport } from 'next';
import { SITE_NAME } from '@/lib/seo';
import { RootDocument, rootMetadata } from '../root-document';

export const metadata: Metadata = {
  ...rootMetadata,
  // In full: a root's own title is not run through its template.
  title: `Gate · ${SITE_NAME}`,
  robots: { index: false, follow: false },
};

// Dark on purpose: a bright screen in a dark doorway blinds the person
// being scanned, and the result colours read better against it.
export const viewport: Viewport = {
  themeColor: '#161412',
  viewportFit: 'cover',
};

/**
 * The door has its own shell — no public header, footer or links out. A
 * root of its own (ADR-079), like admin.
 */
export default function DoorLayout({ children }: LayoutProps<'/door'>) {
  return (
    <RootDocument root="door">
      <div className="flex min-h-dvh flex-1 flex-col bg-[#161412] text-white">{children}</div>
    </RootDocument>
  );
}
