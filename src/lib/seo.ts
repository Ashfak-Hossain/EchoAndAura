import type { Metadata } from 'next';
import { descriptionToPlainText } from '@/server/lib/description';
import { formatBDT } from '@/server/lib/money';
import { publicVenue } from '@/server/lib/venue';
import { formatDhakaLong } from '@/lib/time';

export const SITE_NAME = 'echoandaura';

// Lives in env.public.ts (next-free) so the worker can build email links
// without importing this module's `next` types; re-exported for callers.
export { siteUrl } from '@/lib/env.public';

export const DESCRIPTION_MAX = 160;

export interface EventMetadataInput {
  event: {
    slug: string;
    title: string;
    description: string | null;
    venue: string | null;
    /** A private venue is never in share text — the public area is (ADR-029). */
    venueHidden: boolean;
    venueArea: string | null;
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

export const HOME_TAGLINE =
  'Live events in Dhaka — named tickets, paid by bKash, checked by a person.';

export interface HomeMetadataInput {
  /** The hero event, if any: its cover becomes the share image. */
  featured: { title: string; startsAt: Date; venue: string | null; coverUrl: string | null } | null;
  siteUrl: string;
}

/**
 * Metadata for the home page (A1). With a live event, the share preview
 * names it and uses its cover; otherwise the brand line stands alone.
 */
export function buildHomeMetadata({ featured, siteUrl }: HomeMetadataInput): Metadata {
  const description = featured
    ? truncate(
        `Next: ${featured.title} — ${formatDhakaLong(featured.startsAt)} (Dhaka)${featured.venue ? `, ${featured.venue}` : ''}. ${HOME_TAGLINE}`,
        DESCRIPTION_MAX,
      )
    : HOME_TAGLINE;
  const image = featured?.coverUrl ?? null;

  return {
    title: { absolute: SITE_NAME },
    description,
    alternates: { canonical: siteUrl },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      url: siteUrl,
      title: SITE_NAME,
      description,
      locale: 'en_GB',
      images: image ? [{ url: image, width: 1200, height: 630, alt: featured?.title ?? '' }] : [],
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: SITE_NAME,
      description,
      images: image ? [image] : [],
    },
  };
}

function summarise(event: EventMetadataInput['event'], fromPricePaisa: number | null): string {
  // The stored description may be rich-text HTML (ADR-010); meta wants text.
  const text = descriptionToPlainText(event.description);
  if (text) return truncate(text, DESCRIPTION_MAX);

  const parts = [`${formatDhakaLong(event.startsAt)} (Dhaka)`];
  const where = publicVenue(event).text;
  if (where) parts.push(where);
  if (fromPricePaisa !== null) parts.push(`tickets from ${formatBDT(fromPricePaisa)}`);
  return truncate(parts.join(' · '), DESCRIPTION_MAX);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
