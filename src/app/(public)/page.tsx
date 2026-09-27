import type { Metadata } from 'next';
import { publicVenue } from '@/server/lib/venue';
import { SupportedBy } from '@/components/public/sponsors/supported-by';
import { getSiteSettings } from '@/lib/settings';
import { buildHomeMetadata, siteUrl } from '@/lib/seo';
import { getPublicSponsors } from '@/lib/sponsors';
import { DormantHero } from './home/dormant-hero';
import { FollowBlock } from './home/follow-block';
import { Hero } from './home/hero';
import { HowItWorks } from './home/how-it-works';
import { loadHome } from './home/load';
import { PastStrip } from './home/past-strip';
import { UpcomingGrid } from './home/upcoming-grid';

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

// A1 home (Canvas 6, H1–H3). The hero is the next show still taking
// registrations, else the soonest one (plan decision 6); with no show at all,
// the dormant band. Then the same order of sections at every width — one
// column, never a directory. Each light section carries its own 96/64px top
// padding and the spacer closes the last one.
// `home-page` scopes the ADR-031 focus ring (globals.css).
export default async function HomePage() {
  const [home, settings, sponsors] = await Promise.all([
    loadHome(),
    getSiteSettings(),
    getPublicSponsors(),
  ]);
  const { featured } = home;
  const facebook = settings.facebookPageUrl;

  return (
    <main className="home-page flex flex-1 flex-col">
      {featured ? (
        <Hero featured={featured} now={new Date()} />
      ) : (
        <DormantHero lastShow={home.past[0] ?? null} facebookUrl={facebook} />
      )}
      <UpcomingGrid events={home.alsoUpcoming} upcomingTotal={home.upcomingTotal} />
      <HowItWorks verificationPromise={settings.verificationPromise} />
      <PastStrip events={home.past} />
      <SupportedBy sponsors={sponsors} />
      {/* The dormant band already leads with Facebook; say it once. */}
      {featured && facebook ? <FollowBlock facebookUrl={facebook} /> : null}
      <div aria-hidden="true" className="h-16 lg:h-24" />
    </main>
  );
}
