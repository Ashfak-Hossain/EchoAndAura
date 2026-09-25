import type { ReactNode } from 'react';
import { SiteShell } from '@/components/public/site-shell';
import { FooterSponsors } from '@/components/public/sponsors/footer-sponsors';
import { getPublicSession } from '@/lib/session';
import { getSiteSettings } from '@/lib/settings';
import { getPublicSponsors } from '@/lib/sponsors';
import { featuredCta, hasUpcomingShows } from './home/load';

// Reading the session here makes every public page dynamic — they already
// are (events, orders and tickets are all live data). The featured event
// and the sponsors are the same cached reads the home page makes.
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const [session, cta, hasUpcoming, settings, sponsors] = await Promise.all([
    getPublicSession(),
    featuredCta(),
    hasUpcomingShows(),
    getSiteSettings(),
    getPublicSponsors(),
  ]);
  return (
    <SiteShell
      session={session?.role === 'buyer' ? session : null}
      cta={cta}
      hasUpcoming={hasUpcoming}
      settings={settings}
      sponsorRow={<FooterSponsors sponsors={sponsors} />}
    >
      {children}
    </SiteShell>
  );
}
