import type { Metadata } from 'next';
import { formatBDT } from '@/server/lib/money';
import { formatDhakaLong } from '@/lib/time';

export const SITE_NAME = 'echoandaura';

/**
 * Absolute origin for canonical and Open Graph URLs. Facebook only accepts
 * absolute `og:url` / `og:image`, so this must be the real public origin in
 * production. Falls back to the auth base URL locally.
 */
export function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.SITE_URL ?? env.BETTER_AUTH_URL;
  if (!raw) throw new Error('SITE_URL is not set — see docs/ENVIRONMENT.md');
  return raw.replace(/\/+$/, '');
}

export const DESCRIPTION_MAX = 160;

export interface EventMetadataInput {
  event: {
    slug: string;
    title: string;
    description: string | null;
    venue: string | null;
    startsAt: Date;
  };
  /** Absolute public URL of the cover image, or null when none. */
  coverUrl: string | null;
  /** Lowest ticket price in paisa, or null when there are no ticket types. */
  fromPricePaisa: number | null;
  siteUrl: string;
}

/**
 * Metadata for the public event page (A2). Pure so it is unit-testable:
 * title, a ≤160-char description (from the event, else generated), canonical
 * URL, Open Graph with the cover as a 1200×630 image, Twitter large card.
 */
export function buildEventMetadata({
  event,
  coverUrl,
  fromPricePaisa,
  siteUrl,
}: EventMetadataInput): Metadata {
  const url = `${siteUrl}/events/${event.slug}`;
  const title = event.title;
  const description = summarise(event, fromPricePaisa);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      url,
      title,
      description,
      locale: 'en_GB',
      images: coverUrl
        ? [{ url: coverUrl, width: 1200, height: 630, alt: `Cover image for ${title}` }]
        : [],
    },
    twitter: {
      card: coverUrl ? 'summary_large_image' : 'summary',
      title,
      description,
      images: coverUrl ? [coverUrl] : [],
    },
  };
}

function summarise(event: EventMetadataInput['event'], fromPricePaisa: number | null): string {
  const text = event.description?.replace(/\s+/g, ' ').trim();
  if (text) return truncate(text, DESCRIPTION_MAX);

  const parts = [`${formatDhakaLong(event.startsAt)} (Dhaka)`];
  if (event.venue) parts.push(event.venue);
  if (fromPricePaisa !== null) parts.push(`tickets from ${formatBDT(fromPricePaisa)}`);
  return truncate(parts.join(' · '), DESCRIPTION_MAX);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
