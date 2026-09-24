import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Gate',
  robots: { index: false, follow: false },
};

// Dark on purpose: a bright screen in a dark doorway blinds the person
// being scanned, and the result colours read better against it.
export const viewport: Viewport = {
  themeColor: '#161412',
  viewportFit: 'cover',
};

/** The door has its own shell — no public header, footer or links out. */
export default function DoorLayout({ children }: LayoutProps<'/door'>) {
  return <div className="flex min-h-dvh flex-1 flex-col bg-[#161412] text-white">{children}</div>;
}
