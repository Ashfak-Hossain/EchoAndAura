import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { offerSummary } from '@/server/lib/event-offer';
import type { EventRecord } from '@/server/repositories/events.repository';
import type { TicketTypeRecord } from '@/server/repositories/ticket-types.repository';
import { event, ticketType } from './helpers/fake-db';

/**
 * ADR-055: an event can hide how many tickets are left. When it does, no
 * public surface prints a count and nothing replaces it; "Sold out" stays.
 * Each surface is rendered both ways so a dropped flag fails here.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

const getPublicEvent = vi.fn();
vi.mock('@/server/container', () => ({
  eventsService: { getPublicEvent, coverImageUrl: () => null },
  ordersService: { createOrder: vi.fn(), checkPromo: vi.fn() },
}));
vi.mock('@/lib/session', () => ({ getPublicSession: async () => null }));
vi.mock('@/lib/settings', () => ({
  getSiteSettings: async () => ({ facebookPageUrl: null }),
}));
vi.mock('@/lib/sponsors', () => ({ getPublicSponsors: async () => [] }));

const { TicketList } = await import('@/app/(public)/events/[slug]/ticket-list');
const { EventCta } = await import('@/app/(public)/events/[slug]/cta');
const { RegistrationForm } =
  await import('@/app/(public)/events/[slug]/register/registration-form');
const { default: RegisterPage } = await import('@/app/(public)/events/[slug]/register/page');
const { default: PublicEventPage } = await import('@/app/(public)/events/[slug]/page');
const { Hero } = await import('@/app/(public)/home/hero');

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
/** Visible text, tags stripped and React's text separators dropped. */
const text = (markup: string) =>
  markup
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&');
/** Any "N left" / "N tickets left" / "Only N left" — the thing that must never show. */
const COUNT_LEFT = /\d[\d,]*\s+(tickets?\s+)?left/i;

// The fixture event: opens Fri 11 Sep, closes Sat 26 Sep 19:00 (Dhaka).
const OPEN_NOW = new Date('2026-09-20T10:00:00Z');
const CLOSING_NOW = new Date('2026-09-25T13:00:00Z'); // 24h before the close

// 437 General left; VIP sold out. 437 is distinctive enough to grep for.
const general = ticketType({ id: 'tt-gen', name: 'General', quantityTotal: 500, quantitySold: 63 });
const vip = ticketType({ id: 'tt-vip', name: 'VIP', quantityTotal: 20, quantitySold: 20 });
const types: TicketTypeRecord[] = [general, vip];

const shownEvent = event({ hideAvailability: false });
const hiddenEvent = event({ hideAvailability: true });

describe('TicketList', () => {
  const list = (hideCounts: boolean, compact: boolean, phase: 'open' | 'closing_soon' = 'open') =>
    html(
      createElement(TicketList, { ticketTypes: types, phase, now: OPEN_NOW, compact, hideCounts }),
    );

  for (const compact of [true, false]) {
    const shape = compact ? 'compact rows' : 'chips';
    it(`shown (${shape}): the count is printed`, () => {
      expect(text(list(false, compact))).toMatch(/437 left/);
    });

    it(`hidden (${shape}): no count, nothing in its place; Sold out still shows`, () => {
      for (const phase of ['open', 'closing_soon'] as const) {
        const out = text(list(true, compact, phase));
        expect(out).not.toMatch(COUNT_LEFT);
        expect(out).not.toContain('437');
        expect(out).toContain('General');
        expect(out).toContain('Sold out');
      }
    });
  }
});

describe('EventCta', () => {
  const cta = (phase: 'open' | 'closing_soon' | 'sold_out', hideAvailability: boolean) =>
    text(
      html(
        createElement(EventCta, {
          phase,
          slug: 'live-dhaka',
          registrationOpensAt: shownEvent.registrationOpensAt,
          registrationClosesAt: shownEvent.registrationClosesAt,
          availableTotal: 437,
          hideAvailability,
          facebookUrl: null,
          now: CLOSING_NOW,
        }),
      ),
    );

  it('closing soon, shown: the button carries the count', () => {
    expect(cta('closing_soon', false)).toContain('Register — 437 tickets left');
  });

  it('closing soon, hidden: "Register — closing soon", no number', () => {
    const out = cta('closing_soon', true);
    expect(out).toContain('Register — closing soon');
    expect(out).not.toMatch(COUNT_LEFT);
    expect(out).not.toContain('437');
  });

  it('open and sold out read the same either way', () => {
    expect(cta('open', true)).toBe(cta('open', false));
    expect(cta('sold_out', true)).toBe(cta('sold_out', false));
    expect(cta('sold_out', true)).toContain('Sold out');
  });
});

describe('Hero (home page)', () => {
  const hero = (ev: EventRecord) =>
    text(
      html(
        createElement(Hero, {
          featured: {
            event: ev,
            phase: 'open',
            offer: offerSummary(types, ev, OPEN_NOW),
            availableTotal: 437,
            coverUrl: null,
          },
          now: OPEN_NOW,
        }),
      ),
    );

  it('shown: "437 tickets left"; hidden: no count, the price still shows', () => {
    expect(hero(shownEvent)).toContain('437 tickets left');
    const out = hero(hiddenEvent);
    expect(out).not.toMatch(COUNT_LEFT);
    expect(out).not.toContain('437');
    expect(out).toContain('৳1,200.00');
  });
});

describe('RegistrationForm', () => {
  const form = (available: number | null, maxPerOrder: number) =>
    html(
      createElement(RegistrationForm, {
        action: async () => ({}),
        checkPromo: async () => ({ ok: false, reason: 'unknown' }) as never,
        options: [
          {
            id: 'tt-gen',
            name: 'General',
            pricePaisa: 120_000,
            available,
            maxPerOrder,
            reason: null,
          },
          {
            id: 'tt-vip',
            name: 'VIP',
            pricePaisa: 300_000,
            available: null,
            maxPerOrder: 0,
            reason: 'Sold out',
          },
        ],
        registrationClosesAt: null,
        siteKey: '',
      }),
    );

  it('shown: the row and the hint say how many are left', () => {
    const out = text(form(7, 7));
    expect(out).toContain('Only 7 left');
    expect(out).toContain('7 left at this price');
  });

  it('hidden: no count on the row or in the hint; the stepper allows 10; Sold out stays', () => {
    const markup = form(null, 10);
    const out = text(markup);
    expect(out).not.toMatch(COUNT_LEFT);
    expect(out).not.toContain('at this price');
    expect(out).toContain('Max 10 per order.');
    expect(out).toContain('Sold out');
    expect(markup).toMatch(/<input[^>]*id="quantity"[^>]*max="10"/);
    // No over-stock error can appear without a count to compare against.
    expect(out).not.toMatch(/Only .* tickets are left/);
  });
});

/** Every props object in a rendered element tree, depth first. */
function propsOf(node: ReactNode, type: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement(n)) return;
    const props = n.props as Record<string, unknown> & { children?: ReactNode };
    if (n.type === type) found.push(props);
    walk(props.children);
  };
  walk(node);
  return found;
}

describe('pages', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.stubEnv('SITE_URL', 'https://echoandaura.test');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    getPublicEvent.mockReset();
  });

  const params = Promise.resolve({ slug: 'live-dhaka' });

  it('register page, hidden: the count never reaches the form props; up to 10 may be chosen', async () => {
    vi.setSystemTime(OPEN_NOW);
    getPublicEvent.mockResolvedValue({ event: hiddenEvent, ticketTypes: types });
    const tree = await RegisterPage({ params });
    const [formProps] = propsOf(tree, RegistrationForm);
    expect(formProps?.options).toEqual([
      expect.objectContaining({ id: 'tt-gen', available: null, maxPerOrder: 10, reason: null }),
      expect.objectContaining({
        id: 'tt-vip',
        available: null,
        maxPerOrder: 0,
        reason: 'Sold out',
      }),
    ]);
    expect(JSON.stringify(formProps?.options)).not.toContain('437');
    expect(text(html(tree))).not.toMatch(COUNT_LEFT);
  });

  it('register page, shown: the count and min(10, left) as before', async () => {
    vi.setSystemTime(OPEN_NOW);
    const few = ticketType({ id: 'tt-gen', quantityTotal: 10, quantitySold: 6 });
    getPublicEvent.mockResolvedValue({ event: shownEvent, ticketTypes: [few] });
    const tree = await RegisterPage({ params });
    const [formProps] = propsOf(tree, RegistrationForm);
    expect(formProps?.options).toEqual([
      expect.objectContaining({ id: 'tt-gen', available: 4, maxPerOrder: 4 }),
    ]);
  });

  it('event page, closing soon: hidden prints no count anywhere; shown prints it', async () => {
    vi.setSystemTime(CLOSING_NOW);
    getPublicEvent.mockResolvedValue({ event: hiddenEvent, ticketTypes: types });
    const hidden = text(html(await PublicEventPage({ params })));
    expect(hidden).not.toMatch(COUNT_LEFT);
    expect(hidden).not.toContain('437');
    expect(hidden).toContain('Register — closing soon');
    expect(hidden).toContain('Sold out');

    getPublicEvent.mockResolvedValue({ event: shownEvent, ticketTypes: types });
    const shown = text(html(await PublicEventPage({ params })));
    expect(shown).toContain('Register — 437 tickets left');
    expect(shown).toMatch(/437 left/);
  });
});
