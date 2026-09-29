import { describe, expect, it } from 'vitest';
import {
  buildEventJsonLd,
  buildFaqJsonLd,
  buildHomeJsonLd,
  jsonLdScript,
  type StructuredEvent,
  type StructuredTicketType,
} from '@/lib/structured-data';
import { toDhakaIso } from '@/lib/time';

const site = 'https://echoandaura.com';
const NOW = new Date('2026-09-29T06:00:00Z'); // 12:00 Dhaka

const event: StructuredEvent = {
  slug: 'echo-aura-live',
  title: 'Echo & Aura Live — Dhaka',
  description: '<p>Four acts, one room.</p><h2>The night</h2><p>Doors at 7.</p>',
  venue: 'ICCB Hall 4, Bashundhara, Dhaka',
  venueHidden: false,
  venueArea: null,
  startsAt: new Date('2026-10-10T13:00:00Z'), // 19:00 Dhaka
  endsAt: new Date('2026-10-10T17:00:00Z'),
  registrationOpensAt: new Date('2026-09-20T04:00:00Z'),
  registrationClosesAt: new Date('2026-10-05T17:59:00Z'),
};

const type = (over: Partial<StructuredTicketType> = {}): StructuredTicketType => ({
  name: 'General',
  pricePaisa: 120_000,
  quantityTotal: 300,
  quantitySold: 10,
  quantityReserved: 2,
  salesStartsAt: null,
  salesEndsAt: null,
  ...over,
});

const build = (over: Partial<Parameters<typeof buildEventJsonLd>[0]> = {}) =>
  buildEventJsonLd({
    event,
    ticketTypes: [type()],
    coverUrl: 'https://media.echoandaura.com/events/x/cover.jpg',
    siteUrl: site,
    now: NOW,
    ...over,
  });

type Offer = {
  name: string;
  price: string;
  availability: string;
  validFrom?: string;
  validThrough?: string;
};
const offers = (ld: Record<string, unknown>) => ld.offers as Offer[];

describe('Event JSON-LD (ADR-042)', () => {
  it('describes the event with Dhaka times, an in-person place and the organizer', () => {
    const ld = build();
    expect(ld).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'Echo & Aura Live — Dhaka',
      url: `${site}/events/echo-aura-live`,
      description: 'Four acts, one room. The night Doors at 7.',
      image: ['https://media.echoandaura.com/events/x/cover.jpg'],
      startDate: '2026-10-10T19:00:00+06:00',
      endDate: '2026-10-10T23:00:00+06:00',
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: {
        '@type': 'Place',
        name: 'ICCB Hall 4, Bashundhara, Dhaka',
        address: { addressLocality: 'Dhaka', addressCountry: 'BD' },
      },
      organizer: { '@type': 'Organization', url: site },
    });
  });

  it('prices each ticket type in BDT through money.ts, never as a float', () => {
    const [offer] = offers(build({ ticketTypes: [type({ pricePaisa: 90_050 })] }));
    expect(offer).toMatchObject({ '@type': 'Offer', price: '900.50', priceCurrency: 'BDT' });
  });

  it('never publishes a private venue: only its public area', () => {
    const ld = build({
      // As forPublic hands it over (ADR-029): venue gone, area kept.
      event: { ...event, venue: null, venueHidden: true, venueArea: 'Gulshan, Dhaka' },
    });
    expect(JSON.stringify(ld)).not.toContain('ICCB');
    expect(ld.location).toMatchObject({ name: 'Gulshan, Dhaka' });
  });

  it('with a private venue and no area, says only Dhaka', () => {
    const ld = build({ event: { ...event, venue: null, venueHidden: true, venueArea: null } });
    expect(ld.location).toMatchObject({ name: 'Dhaka' });
    expect((ld.location as { address: object }).address).not.toHaveProperty('streetAddress');
  });

  it('marks availability from the sale state: in stock, sold out, not yet, ended', () => {
    const list = offers(
      build({
        ticketTypes: [
          type({ name: 'General' }),
          type({ name: 'VIP', quantityTotal: 40, quantitySold: 38, quantityReserved: 2 }),
          type({ name: 'Late', salesStartsAt: new Date('2026-10-01T00:00:00Z') }),
          type({ name: 'Early Bird', salesEndsAt: new Date('2026-09-25T17:59:00Z') }),
        ],
      }),
    );
    expect(list.map((o) => [o.name, o.availability.replace('https://schema.org/', '')])).toEqual([
      ['General', 'InStock'],
      ['VIP', 'SoldOut'],
      ['Late', 'PreOrder'],
      ['Early Bird', 'Discontinued'],
    ]);
  });

  it('uses the type’s own sales window, else registration, for validity', () => {
    const [eb, general] = offers(
      build({
        ticketTypes: [
          type({ name: 'Early Bird', salesEndsAt: new Date('2026-10-01T17:59:00Z') }),
          type(),
        ],
      }),
    );
    expect(eb!.validThrough).toBe(toDhakaIso(new Date('2026-10-01T17:59:00Z')));
    expect(general!.validFrom).toBe(toDhakaIso(event.registrationOpensAt!));
    expect(general!.validThrough).toBe(toDhakaIso(event.registrationClosesAt!));
  });

  it('before registration opens, everything is PreOrder; after it closes, Discontinued', () => {
    const early = offers(build({ now: new Date('2026-09-10T00:00:00Z') }));
    expect(early[0]!.availability).toBe('https://schema.org/PreOrder');
    const late = offers(build({ now: new Date('2026-10-07T00:00:00Z') }));
    expect(late[0]!.availability).toBe('https://schema.org/Discontinued');
  });

  it('a past event, or one with no ticket types, has no offers', () => {
    expect(build({ now: new Date('2026-10-11T00:00:00Z') })).not.toHaveProperty('offers');
    expect(build({ ticketTypes: [] })).not.toHaveProperty('offers');
  });

  it('leaves out what is missing rather than inventing it', () => {
    const ld = build({ coverUrl: null, event: { ...event, description: null, endsAt: null } });
    expect(ld).not.toHaveProperty('image');
    expect(ld).not.toHaveProperty('description');
    expect(ld).not.toHaveProperty('endDate');
  });

  it('keeps a long description to a summary', () => {
    const long = `<p>${'word '.repeat(300)}</p>`;
    const d = build({ event: { ...event, description: long } }).description as string;
    expect(d.length).toBeLessThanOrEqual(500);
    expect(d.endsWith('…')).toBe(true);
  });
});

describe('Organization + WebSite JSON-LD', () => {
  it('names the brand, links Facebook and the support contact', () => {
    const ld = buildHomeJsonLd({
      siteUrl: site,
      logoUrl: `${site}/icon`,
      facebookPageUrl: 'https://facebook.com/echoandaura',
      supportEmail: 'hello@echoandaura.com',
      supportPhone: '01712 345678',
    });
    const [org, web] = ld['@graph'] as Record<string, unknown>[];
    expect(org).toMatchObject({
      '@type': 'Organization',
      '@id': `${site}/#organization`,
      name: 'echoandaura',
      alternateName: 'Echo & Aura',
      logo: `${site}/icon`,
      sameAs: ['https://facebook.com/echoandaura'],
      contactPoint: { email: 'hello@echoandaura.com', telephone: '01712 345678' },
    });
    expect(web).toMatchObject({
      '@type': 'WebSite',
      publisher: { '@id': `${site}/#organization` },
    });
  });

  it('omits contact and social links that are not set', () => {
    const ld = buildHomeJsonLd({
      siteUrl: site,
      logoUrl: `${site}/icon`,
      facebookPageUrl: null,
      supportEmail: null,
      supportPhone: null,
    });
    const [org] = ld['@graph'] as Record<string, unknown>[];
    expect(org).not.toHaveProperty('sameAs');
    expect(org).not.toHaveProperty('contactPoint');
  });
});

describe('FAQPage JSON-LD', () => {
  it('lists each question with its plain-text answer', () => {
    const ld = buildFaqJsonLd([{ question: 'Do I need to print?', answer: 'No.' }]);
    expect(ld).toEqual({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Do I need to print?',
          acceptedAnswer: { '@type': 'Answer', text: 'No.' },
        },
      ],
    });
  });
});

describe('jsonLdScript: injection-safe', () => {
  it('a title containing </script> cannot close the script element', () => {
    const out = jsonLdScript(
      build({ event: { ...event, title: 'Night</script><script>alert(1)</script>' } }),
    );
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<');
    // Still the same data once parsed.
    expect(JSON.parse(out).name).toBe('Night</script><script>alert(1)</script>');
  });

  it('escapes the JavaScript line separators', () => {
    const out = jsonLdScript({ name: 'a b c' });
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
    expect(JSON.parse(out).name).toBe('a b c');
  });
});
