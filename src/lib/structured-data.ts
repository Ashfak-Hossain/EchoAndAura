import { descriptionToPlainText } from '@/server/lib/description';
import { formatDecimalBDT } from '@/server/lib/money';
import { ticketTypeSaleState } from '@/server/lib/ticket-type-sale-state';
import { publicVenue } from '@/server/lib/venue';
import { toDhakaIso } from '@/lib/time';

/**
 * ADR-042: schema.org JSON-LD for search engines and AI assistants. Pure
 * builders, so they are unit-tested like the rest of the SEO code; pages
 * render the result with `jsonLdScript`.
 *
 * Everything here describes public facts only. The event arrives through
 * `forPublic` (ADR-029), and the venue goes through `publicVenue`, so a
 * private venue is never in the markup: only its public area is.
 */

export const BRAND_NAME = 'echoandaura';
export const BRAND_ALTERNATE_NAME = 'Echo & Aura';

/** schema.org caps nothing, but a description is a summary, not the page. */
const EVENT_DESCRIPTION_MAX = 500;

type JsonLd = Record<string, unknown>;

export interface StructuredEvent {
  slug: string;
  title: string;
  description: string | null;
  venue: string | null;
  venueHidden: boolean;
  venueArea: string | null;
  startsAt: Date;
  endsAt: Date | null;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
}

export interface StructuredTicketType {
  name: string;
  pricePaisa: number;
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
  salesStartsAt: Date | null;
  salesEndsAt: Date | null;
}

export interface EventJsonLdInput {
  event: StructuredEvent;
  ticketTypes: readonly StructuredTicketType[];
  coverUrl: string | null;
  siteUrl: string;
  now: Date;
}

/**
 * One offer's availability, in schema.org's vocabulary. Registration is the
 * outer window, a ticket type's own sales window (Early Bird) the inner one.
 */
function availability(
  t: StructuredTicketType,
  event: StructuredEvent,
  now: Date,
): 'InStock' | 'SoldOut' | 'PreOrder' | 'Discontinued' {
  const state = ticketTypeSaleState(t, now);
  if (state === 'sold_out') return 'SoldOut';
  const t0 = now.getTime();
  if (event.registrationClosesAt && event.registrationClosesAt.getTime() <= t0) {
    return 'Discontinued';
  }
  if (state === 'window_ended') return 'Discontinued';
  if (state === 'opens_later') return 'PreOrder';
  if (!event.registrationOpensAt || event.registrationOpensAt.getTime() > t0) return 'PreOrder';
  return 'InStock';
}

export function buildEventJsonLd({
  event,
  ticketTypes,
  coverUrl,
  siteUrl,
  now,
}: EventJsonLdInput): JsonLd {
  const url = `${siteUrl}/events/${event.slug}`;
  const where = publicVenue(event).text;
  const description = truncate(descriptionToPlainText(event.description));
  const past = event.startsAt.getTime() <= now.getTime();

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    url,
    ...(description ? { description } : {}),
    ...(coverUrl ? { image: [coverUrl] } : {}),
    startDate: toDhakaIso(event.startsAt),
    ...(event.endsAt ? { endDate: toDhakaIso(event.endsAt) } : {}),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      // A private venue's name stays private; the public area stands in.
      name: where ?? 'Dhaka',
      address: {
        '@type': 'PostalAddress',
        ...(where ? { streetAddress: where } : {}),
        addressLocality: 'Dhaka',
        addressCountry: 'BD',
      },
    },
    organizer: organizationRef(siteUrl),
    // A past event is no longer for sale: offers would only confuse.
    ...(past || ticketTypes.length === 0
      ? {}
      : {
          offers: ticketTypes.map((t) => {
            const validFrom = t.salesStartsAt ?? event.registrationOpensAt;
            const validThrough = t.salesEndsAt ?? event.registrationClosesAt;
            return {
              '@type': 'Offer',
              name: t.name,
              // Through money.ts (Invariant 1): "900.00", never a float.
              price: formatDecimalBDT(t.pricePaisa),
              priceCurrency: 'BDT',
              url,
              availability: `https://schema.org/${availability(t, event, now)}`,
              ...(validFrom ? { validFrom: toDhakaIso(validFrom) } : {}),
              ...(validThrough ? { validThrough: toDhakaIso(validThrough) } : {}),
            };
          }),
        }),
  };
}

export interface OrganizationInput {
  siteUrl: string;
  logoUrl: string;
  facebookPageUrl: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
}

function organizationRef(siteUrl: string): JsonLd {
  return {
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: BRAND_NAME,
    url: siteUrl,
  };
}

/** The home page: who runs the site, and the site itself. */
export function buildHomeJsonLd({
  siteUrl,
  logoUrl,
  facebookPageUrl,
  supportEmail,
  supportPhone,
}: OrganizationInput): JsonLd {
  const contact =
    supportEmail || supportPhone
      ? {
          contactPoint: {
            '@type': 'ContactPoint',
            contactType: 'customer support',
            ...(supportEmail ? { email: supportEmail } : {}),
            ...(supportPhone ? { telephone: supportPhone } : {}),
            areaServed: 'BD',
            availableLanguage: ['en', 'bn'],
          },
        }
      : {};
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        ...organizationRef(siteUrl),
        alternateName: BRAND_ALTERNATE_NAME,
        logo: logoUrl,
        ...(facebookPageUrl ? { sameAs: [facebookPageUrl] } : {}),
        ...contact,
      },
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        name: BRAND_NAME,
        alternateName: BRAND_ALTERNATE_NAME,
        url: siteUrl,
        inLanguage: 'en',
        publisher: { '@id': `${siteUrl}/#organization` },
      },
    ],
  };
}

export interface FaqJsonLdItem {
  question: string;
  /** Plain text: the page renders the answer's markup to text first. */
  answer: string;
}

export function buildFaqJsonLd(items: readonly FaqJsonLdItem[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((i) => ({
      '@type': 'Question',
      name: i.question,
      acceptedAnswer: { '@type': 'Answer', text: i.answer },
    })),
  };
}

/**
 * The JSON for a `<script type="application/ld+json">`. Event titles and
 * descriptions are typed by an admin, so `<` is escaped: a title containing
 * `</script>` must not end the script element and start markup. U+2028/9
 * are escaped too, for old parsers that treat them as line breaks.
 */
export function jsonLdScript(data: JsonLd): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function truncate(text: string): string {
  if (text.length <= EVENT_DESCRIPTION_MAX) return text;
  const cut = text.slice(0, EVENT_DESCRIPTION_MAX - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > EVENT_DESCRIPTION_MAX * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
