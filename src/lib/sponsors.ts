import { cache } from 'react';
import { sponsorsService } from '@/server/container';
import type { PublicSponsor } from '@/server/services/sponsors.service';

/**
 * The active sponsors for this request, in display order. The footer's
 * sponsor row (every public page, via the layout) and the home page's
 * "Supported by" both draw them; React `cache()` makes that one query per
 * request, not one per section.
 */
export const getPublicSponsors = cache((): Promise<PublicSponsor[]> =>
  sponsorsService.listPublic(),
);
