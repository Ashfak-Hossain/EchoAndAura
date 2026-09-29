import type { MetadataRoute } from 'next';

/**
 * ADR-042: what crawlers are told. Pure, so tests pin the rules; the route
 * files in src/app only pass the site URL and the events.
 */

/** Every public page that isn't an event, in the order people find them. */
export const STATIC_PUBLIC_PATHS = [
  '/',
  '/events',
  '/archive',
  '/about',
  '/faq',
  '/contact',
  '/terms',
  '/privacy',
  '/refund',
] as const;

/**
 * Never crawled. The private pages are also `noindex` (and unlinked); this
 * keeps crawlers from spending the site's crawl budget on forms and admin.
 */
export const DISALLOWED_PATHS = [
  '/admin',
  '/api/',
  '/door',
  '/orders/',
  '/tickets/',
  '/account',
  '/events/*/register',
] as const;

export function buildRobots(siteUrl: string): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: [...DISALLOWED_PATHS] }],
    // No `Host:` line: Google ignores it, and Yandex wants a bare host name.
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}

export interface SitemapEvent {
  slug: string;
  updatedAt: Date;
}

export function buildSitemap(
  siteUrl: string,
  events: readonly SitemapEvent[],
): MetadataRoute.Sitemap {
  return [
    ...STATIC_PUBLIC_PATHS.map((path) => ({ url: path === '/' ? siteUrl : `${siteUrl}${path}` })),
    ...events.map((e) => ({ url: `${siteUrl}/events/${e.slug}`, lastModified: e.updatedAt })),
  ];
}

/**
 * RFC 9116 security.txt. `Expires` must be under a year ahead; it is
 * computed per request (six months out), because the contacts it lists are
 * the ones SECURITY.md keeps current, not a file anyone has to remember.
 */
export function buildSecurityTxt(siteUrl: string, now: Date): string {
  const expires = new Date(now.getTime() + 182 * 24 * 60 * 60 * 1000);
  return [
    'Contact: https://github.com/Ashfak-Hossain/EchoAndAura/security/advisories/new',
    'Contact: mailto:hello@echoandaura.com',
    `Expires: ${expires.toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
    'Policy: https://github.com/Ashfak-Hossain/EchoAndAura/blob/main/SECURITY.md',
    'Preferred-Languages: en, bn',
    `Canonical: ${siteUrl}/.well-known/security.txt`,
    '',
  ].join('\n');
}
