import type { Metadata } from 'next';
import { createTranslator } from 'use-intl/core';
import { catalogue } from '@/i18n/catalogue';
import { type Locale, localisedPath } from '@/i18n/locales';
import en from '@/messages/en';
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
  /** ADR-061: the page's language (English by default). */
  locale?: Locale;
}

/** `og:locale` for a language. */
export function ogLocale(locale: Locale): string {
  return locale === 'bn' ? 'bn_BD' : 'en_GB';
}

const seoText = (locale: Locale) =>
  createTranslator({ locale, messages: catalogue(locale), namespace: 'seo' });

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
  locale = 'en',
}: EventMetadataInput): Metadata {
  const t = seoText(locale);
  const url = `${siteUrl}${localisedPath(`/events/${event.slug}`, locale)}`;
  const title = event.title;
  const description = summarise(event, fromPricePaisa, locale);

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
      locale: ogLocale(locale),
      // No cover: leave images out, so the site's generated share image
      // (src/app/opengraph-image.tsx) is used instead of none (ADR-042).
      ...(coverUrl
        ? { images: [{ url: coverUrl, width: 1200, height: 630, alt: t('coverAlt', { title }) }] }
        : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(coverUrl ? { images: [coverUrl] } : {}),
    },
  };
}

/**
 * The home page's <title> (ADR-042): the brand plus what the site is, which
 * is what people search for. Other pages keep the "Page · echoandaura" template.
 */
export const HOME_TITLE = en.seo.homeTitle;

export const HOME_TAGLINE = en.seo.tagline;

export interface HomeMetadataInput {
  /** The hero event, if any: its cover becomes the share image. */
  featured: { title: string; startsAt: Date; venue: string | null; coverUrl: string | null } | null;
  siteUrl: string;
  /** ADR-061: the page's language (English by default). */
  locale?: Locale;
}

/**
 * Metadata for the home page (A1). With a live event, the share preview
 * names it and uses its cover; otherwise the brand line stands alone.
 */
export function buildHomeMetadata({
  featured,
  siteUrl,
  locale = 'en',
}: HomeMetadataInput): Metadata {
  const t = seoText(locale);
  const hero = createTranslator({ locale, messages: catalogue(locale), namespace: 'hero' });
  const homeTitle = t('homeTitle');
  const tagline = t('tagline');
  const description = featured
    ? truncate(
        t('next', {
          title: featured.title,
          when: hero('inDhaka', { when: formatDhakaLong(featured.startsAt, locale) }),
          venue: featured.venue ? `, ${featured.venue}` : '',
          tagline,
        }),
        DESCRIPTION_MAX,
      )
    : tagline;
  const image = featured?.coverUrl ?? null;
  const url = `${siteUrl}${locale === 'bn' ? '/bn' : ''}`;

  return {
    title: { absolute: homeTitle },
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      url,
      title: homeTitle,
      description,
      locale: ogLocale(locale),
      ...(image
        ? { images: [{ url: image, width: 1200, height: 630, alt: featured?.title ?? '' }] }
        : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: homeTitle,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

function summarise(
  event: EventMetadataInput['event'],
  fromPricePaisa: number | null,
  locale: Locale,
): string {
  // The stored description may be rich-text HTML (ADR-010); meta wants text.
  const text = descriptionToPlainText(event.description);
  if (text) return truncate(text, DESCRIPTION_MAX);

  const t = seoText(locale);
  const hero = createTranslator({ locale, messages: catalogue(locale), namespace: 'hero' });
  const parts = [hero('inDhaka', { when: formatDhakaLong(event.startsAt, locale) })];
  const where = publicVenue(event).text;
  if (where) parts.push(where);
  if (fromPricePaisa !== null) {
    parts.push(t('ticketsFrom', { price: formatBDT(fromPricePaisa, locale) }));
  }
  return truncate(parts.join(' · '), DESCRIPTION_MAX);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
