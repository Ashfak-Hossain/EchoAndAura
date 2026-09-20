import { cache } from 'react';
import { eventsService } from '@/server/container';

/**
 * The home read model, memoised per request: the public layout needs the
 * featured event for the header's "Get tickets" button and the home page
 * needs all of it. React `cache()` makes that one query, not two.
 */
export const loadHome = cache(() => eventsService.getHomePage());

/** What the site chrome needs: where the header CTA points, if anywhere. */
export async function featuredCta(): Promise<{ slug: string } | null> {
  const { featured } = await loadHome();
  if (!featured) return null;
  const open = featured.phase === 'open' || featured.phase === 'closing_soon';
  return open ? { slug: featured.event.slug } : null;
}
