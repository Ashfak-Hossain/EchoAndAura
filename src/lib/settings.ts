import { cache } from 'react';
import { settingsService } from '@/server/container';
import type { SiteSettings } from '@/server/services/settings.service';

/**
 * The site settings for this request. Several components on one page read
 * them (shell footer, contact card, payment steps); React `cache()` makes
 * that one query per request, not one per component.
 */
export const getSiteSettings = cache((): Promise<SiteSettings> => settingsService.get());
