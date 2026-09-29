import { describe, expect, it } from 'vitest';
import {
  DISALLOWED_PATHS,
  STATIC_PUBLIC_PATHS,
  buildRobots,
  buildSecurityTxt,
  buildSitemap,
} from '@/lib/crawl';

const site = 'https://echoandaura.com';

describe('robots.txt (ADR-042)', () => {
  const robots = buildRobots(site);
  const rule = Array.isArray(robots.rules) ? robots.rules[0]! : robots.rules;

  it('allows the public site and points at the sitemap', () => {
    expect(rule.userAgent).toBe('*');
    expect(rule.allow).toBe('/');
    expect(robots.sitemap).toBe(`${site}/sitemap.xml`);
    expect(robots).not.toHaveProperty('host');
  });

  it('keeps crawlers out of the admin, the API, the door and every private page', () => {
    for (const p of ['/admin', '/api/', '/door', '/orders/', '/tickets/', '/account']) {
      expect(rule.disallow).toContain(p);
    }
    expect(rule.disallow).toContain('/events/*/register');
  });

  it('never disallows a page that is in the sitemap', () => {
    for (const path of STATIC_PUBLIC_PATHS) {
      for (const blocked of DISALLOWED_PATHS) {
        if (blocked.includes('*')) continue;
        expect(path.startsWith(blocked)).toBe(false);
      }
    }
  });
});

describe('sitemap.xml (ADR-042)', () => {
  it('lists the static pages and each event with when it last changed', () => {
    const updatedAt = new Date('2026-09-20T08:00:00Z');
    const map = buildSitemap(site, [{ slug: 'echo-aura-live', updatedAt }]);
    expect(map[0]).toEqual({ url: site });
    expect(map.map((e) => e.url)).toContain(`${site}/faq`);
    expect(map.at(-1)).toEqual({ url: `${site}/events/echo-aura-live`, lastModified: updatedAt });
    expect(map).toHaveLength(STATIC_PUBLIC_PATHS.length + 1);
  });

  it('still lists the static pages with no events at all', () => {
    expect(buildSitemap(site, [])).toHaveLength(STATIC_PUBLIC_PATHS.length);
  });
});

describe('security.txt (RFC 9116)', () => {
  const now = new Date('2026-09-29T10:00:00.123Z');
  const txt = buildSecurityTxt(site, now);

  it('has the required fields and a private way to report', () => {
    expect(txt).toMatch(/^Contact: https:\/\/github\.com\/.+\/security\/advisories\/new$/m);
    expect(txt).toMatch(/^Contact: mailto:hello@echoandaura\.com$/m);
    expect(txt).toMatch(/^Canonical: https:\/\/echoandaura\.com\/\.well-known\/security\.txt$/m);
  });

  it('expires in the future but less than a year ahead, in the RFC format', () => {
    const m = txt.match(/^Expires: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/m);
    expect(m).not.toBeNull();
    const expires = new Date(m![1]!).getTime();
    expect(expires).toBeGreaterThan(now.getTime());
    expect(expires - now.getTime()).toBeLessThan(365 * 24 * 60 * 60 * 1000);
  });
});
