import type { MetadataRoute } from 'next';
import { buildRobots } from '@/lib/crawl';
import { siteUrl } from '@/lib/env.public';

// Per request: at build time SITE_URL is a placeholder (ADR-042).
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return buildRobots(siteUrl());
}
