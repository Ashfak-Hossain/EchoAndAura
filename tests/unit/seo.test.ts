import { describe, expect, it } from 'vitest';
import { DESCRIPTION_MAX, buildEventMetadata, siteUrl } from '@/lib/seo';

const event = {
  slug: 'echo-aura-live-dhaka',
  title: 'Echo & Aura Live — Dhaka',
  description: 'Four acts, one night, no support slots.',
  venue: 'ICCB Hall 4, Dhaka',
  startsAt: new Date('2026-10-01T13:00:00Z'),
};
const cover = 'https://cdn.example.com/events/1/cover-abc.jpg';
const site = 'https://echoandaura.com';

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe('siteUrl', () => {
  it('prefers SITE_URL, falls back to BETTER_AUTH_URL, strips trailing slashes', () => {
    expect(siteUrl(env({ SITE_URL: 'https://a.com/' }))).toBe('https://a.com');
    expect(siteUrl(env({ BETTER_AUTH_URL: 'http://localhost:3000' }))).toBe(
      'http://localhost:3000',
    );
    expect(() => siteUrl(env({}))).toThrow(/SITE_URL/);
  });
});

describe('buildEventMetadata', () => {
  it('sets canonical, Open Graph with the 1200×630 cover, and a large Twitter card', () => {
    const m = buildEventMetadata({ event, coverUrl: cover, fromPricePaisa: 80_000, siteUrl: site });
    expect(m.title).toBe(event.title);
    expect(m.alternates?.canonical).toBe(`${site}/events/${event.slug}`);
    const og = m.openGraph as { url?: string; images?: unknown[]; type?: string };
    expect(og.url).toBe(`${site}/events/${event.slug}`);
    expect(og.type).toBe('website');
    expect(og.images).toEqual([{ url: cover, width: 1200, height: 630, alt: expect.any(String) }]);
    expect((m.twitter as { card?: string }).card).toBe('summary_large_image');
  });

  it('generates a description from date, venue and lowest price when the event has none', () => {
    const m = buildEventMetadata({
      event: { ...event, description: null },
      coverUrl: null,
      fromPricePaisa: 80_000,
      siteUrl: site,
    });
    expect(m.description).toBe('Thu 1 Oct 2026, 19:00 (Dhaka) · ICCB Hall 4, Dhaka · tickets from ৳800.00');
    expect((m.openGraph as { images?: unknown[] }).images).toEqual([]);
    expect((m.twitter as { card?: string }).card).toBe('summary');
  });

  it('collapses whitespace and truncates long descriptions on a word boundary', () => {
    const long = 'word '.repeat(80);
    const m = buildEventMetadata({
      event: { ...event, description: long },
      coverUrl: null,
      fromPricePaisa: null,
      siteUrl: site,
    });
    expect(m.description!.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(m.description!.endsWith('…')).toBe(true);
    expect(m.description).not.toMatch(/ …$/);
  });
});
