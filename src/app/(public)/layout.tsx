import type { ReactNode } from 'react';
import { SiteShell } from '@/components/public/site-shell';
import { getPublicSession } from '@/lib/session';

// Reading the session here makes every public page dynamic — they already
// are (events, orders and tickets are all live data).
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const session = await getPublicSession();
  return <SiteShell session={session?.role === 'buyer' ? session : null}>{children}</SiteShell>;
}
