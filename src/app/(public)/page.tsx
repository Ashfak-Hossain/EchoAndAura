import type { Metadata } from 'next';
import { cache } from 'react';
import { eventsService } from '@/server/container';
import { facebookPageUrl } from '@/lib/env.public';
import { buildHomeMetadata, siteUrl } from '@/lib/seo';
import { Hero } from './home/hero';
import { NoLiveEvent } from './home/no-live-event';
import { PastStrip } from './home/past-strip';
import { TrustPoints } from './home/trust-points';
import { UpcomingRow } from './home/upcoming-row';

// No params, cookies or fetch here, so Next would otherwise prerender the
// home page at build time with whatever the database held then. It must
// reflect publishes and phase changes on every request.
export const dynamic = 'force-dynamic';

// generateMetadata and the page both need it; one query per request.
const loadHome = cache(() => eventsService.getHomePage());

export async function generateMetadata(): Promise<Metadata> {
  const { featured } = await loadHome();
  return buildHomeMetadata({
    featured: featured
      ? {
          title: featured.event.title,
          startsAt: featured.event.startsAt,
          venue: featured.event.venue,
          coverUrl: featured.coverUrl,
        }
      : null,
    siteUrl: siteUrl(),
  });
}

// A1 home. Hero is the soonest published event (or the dormant brand block);
// everything below keeps the same order at every width — one column of
// sections, never a directory.
export default async function HomePage() {
  const home = await loadHome();
  const facebook = facebookPageUrl();

  return (
    <div className="flex flex-1 flex-col">
      {home.featured ? <Hero featured={home.featured} /> : <NoLiveEvent facebookUrl={facebook} />}

      <div className="mx-auto flex w-full max-w-290 flex-col gap-10 px-4 py-8 lg:gap-14 lg:px-12 lg:py-12">
        <UpcomingRow events={home.alsoUpcoming} />
        <TrustPoints />
        <PastStrip events={home.past} />
      </div>
    </div>
  );
}
