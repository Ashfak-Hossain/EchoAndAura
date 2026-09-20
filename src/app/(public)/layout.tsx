import type { ReactNode } from 'react';
import { SiteShell } from '@/components/public/site-shell';
import { getPublicSession } from '@/lib/session';
import { featuredCta } from './home/load';

// Reading the session here makes every public page dynamic — they already
// are (events, orders and tickets are all live data). The featured event
// is the same cached read the home page makes.
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const [session, cta] = await Promise.all([getPublicSession(), featuredCta()]);
  return (
    <SiteShell session={session?.role === 'buyer' ? session : null} cta={cta}>
      {children}
    </SiteShell>
  );
}
