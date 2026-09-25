import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OfferSummary } from '@/server/lib/event-offer';
import { forPublic } from '@/server/lib/venue';
import type { HomeEvent } from '@/server/services/events.service';
import { EventCard } from '@/components/public/event-card';
import { PhaseChip } from '@/components/public/phase-chip';
import { event } from './helpers/fake-db';
import { coverSources } from './helpers/next-image';

const offer = (over: Partial<OfferSummary> = {}): OfferSummary => ({
  fromPricePaisa: 60_000,
  fromTypeName: 'Early Bird',
  fromIsEarlyBird: true,
  earlyBird: null,
  earlyBirdOnSale: false,
  highlightId: null,
  ...over,
});

const item = (over: Partial<HomeEvent> = {}): HomeEvent => ({
  event: event({
    slug: 'late-set-chattogram',
    title: 'Late Set — Chattogram',
    venue: 'Bayside Hall, Khulshi, Chattogram',
    // Fri 6 Nov 2026, 20:00 in Dhaka.
    startsAt: new Date('2026-11-06T14:00:00Z'),
    registrationOpensAt: new Date('2026-10-17T14:00:00Z'),
  }),
  phase: 'open',
  offer: offer(),
  availableTotal: 112,
  coverUrl: 'https://cdn.test/events/ev-1/cover-x.png',
  ...over,
});

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('EventCard (N8)', () => {
  it('is one link to the event page with chip, title, Dhaka time, venue and from-price', () => {
    const out = html(createElement(EventCard, { item: item() }));
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).toContain('href="/events/late-set-chattogram"');
    expect(out).toContain('On sale');
    expect(out).toMatch(/<h3[^>]*>Late Set — Chattogram<\/h3>/);
    expect(out).toContain('Fri 6 Nov 2026, 20:00 (Dhaka)');
    expect(out).toContain('Bayside Hall, Khulshi, Chattogram');
    expect(out).toContain('From ৳600.00');
    expect(out).toMatch(/<img[^>]*loading="lazy"/);
    expect(out).toContain('alt=""');
    // Through the optimizer (ADR-033): a srcset, and a column-sized pick.
    expect(coverSources(out)).toEqual(['https://cdn.test/events/ev-1/cover-x.png']);
    expect(out).toMatch(/srcSet="\/_next\/image\?url=[^"]*&amp;w=640&amp;q=75 640w/);
    expect(out).toContain('sizes="(min-width: 1440px) 656px, (min-width: 768px) 50vw, 100vw"');
  });

  it('the wide card asks for its 7fr cover column, not half the page', () => {
    const out = html(createElement(EventCard, { item: item(), variant: 'wide' }));
    expect(out).toContain('sizes="(min-width: 1440px) 764px, (min-width: 1024px) 55vw, 100vw"');
  });

  it('says "Early Bird on sale" while the Early Bird sells', () => {
    const out = html(
      createElement(EventCard, { item: item({ offer: offer({ earlyBirdOnSale: true }) }) }),
    );
    expect(out).toContain('Early Bird on sale');
  });

  it('dates a show that is not on sale yet', () => {
    const out = html(createElement(EventCard, { item: item({ phase: 'not_open' }) }));
    expect(out).toContain('On sale 17 Oct');
  });

  it('a private venue shows the area and the note, never the venue (ADR-029)', () => {
    const secret = event({ venue: 'Warehouse 7', venueHidden: true, venueArea: 'Banani, Dhaka' });
    const out = html(createElement(EventCard, { item: item({ event: forPublic(secret) }) }));
    expect(out).toContain('Banani, Dhaka');
    expect(out).toContain('Exact venue is sent with your tickets');
    expect(out).not.toContain('Warehouse 7');
  });

  it('without a cover draws a tint block, and without ticket types no price', () => {
    const out = html(
      createElement(EventCard, {
        item: item({ coverUrl: null, offer: offer({ fromPricePaisa: null, fromTypeName: null }) }),
      }),
    );
    expect(out).not.toContain('<img');
    expect(out).not.toContain('From ৳');
  });

  it('the wide variant lies on its side from lg; the heading level follows the page', () => {
    const out = html(createElement(EventCard, { item: item(), variant: 'wide', headingLevel: 2 }));
    expect(out).toContain('lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]');
    expect(out).toContain('lg:text-[30px]');
    expect(out).toMatch(/<h2[^>]*>Late Set — Chattogram<\/h2>/);
    expect(html(createElement(EventCard, { item: item() }))).not.toContain('lg:grid-cols-');
  });
});

describe('PhaseChip', () => {
  const opens = new Date('2026-10-17T14:00:00Z');

  it('uses the Canvas 6 words: hero says "Not on sale yet", a card carries the date', () => {
    const chip = (variant: 'hero' | 'card') =>
      html(
        createElement(PhaseChip, {
          phase: 'not_open',
          registrationOpensAt: opens,
          earlyBirdOnSale: false,
          variant,
        }),
      );
    expect(chip('hero')).toContain('Not on sale yet');
    expect(chip('card')).toContain('On sale 17 Oct');
  });

  it('live phases carry the dot; the rest do not', () => {
    const chip = (phase: HomeEvent['phase']) =>
      html(
        createElement(PhaseChip, {
          phase,
          registrationOpensAt: opens,
          earlyBirdOnSale: false,
          variant: 'card',
        }),
      );
    expect(chip('open')).toContain('aria-hidden="true"');
    expect(chip('closing_soon')).toContain('Closing soon');
    expect(chip('sold_out')).not.toContain('aria-hidden="true"');
    expect(chip('closed')).toContain('Registration closed');
    expect(chip('past')).toContain('Past');
  });
});
