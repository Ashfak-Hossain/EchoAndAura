import { cache } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import type { FeaturedCta } from '@/lib/public-nav';
import { DHAKA_TZ } from '@/lib/time';
import { eventsService } from '@/server/container';

/**
 * The home read model, memoised per request: the public layout needs the
 * featured event for the header's "Get tickets" button and the home page
 * needs all of it. React `cache()` makes that one query, not two.
 */
export const loadHome = cache(() => eventsService.getHomePage());

/**
 * What the site chrome needs: where "Get tickets" points and, for the phone
 * menu, which show it is. Null unless the featured event is buyable — N3
 * omits the button rather than disabling it.
 */
export async function featuredCta(): Promise<FeaturedCta | null> {
  const { featured } = await loadHome();
  if (!featured) return null;
  const open = featured.phase === 'open' || featured.phase === 'closing_soon';
  if (!open) return null;
  return {
    slug: featured.event.slug,
    title: featured.event.title,
    // Formatted here, not in the menu: the menu is a client component and
    // must not depend on the browser's time zone.
    dateLabel: formatInTimeZone(featured.event.startsAt, DHAKA_TZ, 'EEE d MMM yyyy'),
  };
}

/** Whether any upcoming show exists, for the phone menu's fallback line. */
export async function hasUpcomingShows(): Promise<boolean> {
  const { upcomingTotal } = await loadHome();
  return upcomingTotal > 0;
}
