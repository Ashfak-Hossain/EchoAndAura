import type { Metadata } from 'next';
import { publicVenue } from '@/server/lib/venue';
import { getSiteSettings } from '@/lib/settings';
import { buildHomeMetadata, siteUrl } from '@/lib/seo';
import { Hero } from './home/hero';
import { loadHome } from './home/load';
import { NoLiveEvent } from './home/no-live-event';
import { PastStrip } from './home/past-strip';
import { TrustPoints } from './home/trust-points';
import { UpcomingRow } from './home/upcoming-row';

// No params, cookies or fetch here, so Next would otherwise prerender the
// home page at build time with whatever the database held then. It must
// reflect publishes and phase changes on every request.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { featured } = await loadHome();
  return buildHomeMetadata({
    featured: featured
      ? {
          title: featured.event.title,
          startsAt: featured.event.startsAt,
          venue: publicVenue(featured.event).text,
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
  const [home, settings] = await Promise.all([loadHome(), getSiteSettings()]);
  const facebook = settings.facebookPageUrl;

  return (
    <div className="flex flex-1 flex-col">
      {home.featured ? <Hero featured={home.featured} /> : <NoLiveEvent facebookUrl={facebook} />}

      {home.alsoUpcoming.length > 0 ? (
        <div className="mx-auto w-full max-w-360 px-4 py-8 lg:px-16 lg:py-16">
          <UpcomingRow events={home.alsoUpcoming} />
        </div>
      ) : null}
      <TrustPoints verificationPromise={settings.verificationPromise} />
      {home.past.length > 0 ? (
        <div className="mx-auto w-full max-w-360 px-4 py-8 lg:px-16 lg:py-16">
          <PastStrip events={home.past} />
        </div>
      ) : null}
    </div>
  );
}
