import type { MetadataRoute } from 'next';
import { eventsService } from '@/server/container';
import { buildSitemap } from '@/lib/crawl';
import { siteUrl } from '@/lib/env.public';

// Per request: the events live in the database, and SITE_URL is a
// placeholder at build time (ADR-042).
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemap(siteUrl(), await eventsService.getSitemapEvents());
}
