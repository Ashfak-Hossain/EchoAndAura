import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventRecord } from '@/server/repositories/events.repository';
import { offerSummary } from '@/server/lib/event-offer';
import { MAX_TICKETS_PER_ORDER } from '@/server/lib/order-rules';
import { forPublic } from '@/server/lib/venue';
import type { HomeEvent } from '@/server/services/events.service';
import type { SiteSettings } from '@/server/services/settings.service';
import { HOLD_HOURS } from '@/content/site';
import { event, ticketType } from './helpers/fake-db';

// The countdown island asks the router for a refresh at zero.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// Only the page composition test reads these; the sections take props.
const getHomePage = vi.fn();
const getSettings = vi.fn();
const listPublic = vi.fn();
vi.mock('@/server/container', () => ({
  eventsService: { getHomePage },
  settingsService: { get: getSettings },
  sponsorsService: { listPublic },
}));

const { Hero } = await import('@/app/(public)/home/hero');
const { Countdown, countdownLabel, countdownParts } = await import('@/app/(public)/home/countdown');
const { DormantHero } = await import('@/app/(public)/home/dormant-hero');
const { UpcomingGrid } = await import('@/app/(public)/home/upcoming-grid');
const { HowItWorks, howItWorksSteps } = await import('@/app/(public)/home/how-it-works');
const { PastStrip } = await import('@/app/(public)/home/past-strip');
const { FollowBlock } = await import('@/app/(public)/home/follow-block');
const { default: HomePage } = await import('@/app/(public)/page');

/**
 * Canvas 6 home page (H1–H3, N6–N9), rendered to markup. Times are UTC;
 * comments give Dhaka wall time (UTC+6). The words themselves are pinned
 * in hero-copy.test.ts; here we check each state draws the right pieces.
 */
const at = (iso: string) => new Date(iso);
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
/** Visible text, tags stripped, so a sentence split by <strong> reads as one. */
const text = (markup: string) => markup.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
/** Every link as [href, text]. */
const links = (markup: string) =>
  [...markup.matchAll(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g)].map((m) => [m[1], text(m[2])]);

const NOW = at('2026-10-05T06:00:00Z'); // Mon 5 Oct 12:00
const show = event({
  slug: 'winter-night-dhaka',
  title: 'Winter Night — Dhaka',
  venue: 'The Attic, Gulshan 2, Dhaka',
  startsAt: at('2026-10-17T13:00:00Z'), // Sat 17 Oct 19:00
  registrationOpensAt: at('2026-09-27T04:00:00Z'), // Sun 27 Sep 10:00
  registrationClosesAt: at('2026-10-12T17:59:00Z'), // Mon 12 Oct 23:59
});
const general = ticketType({ quantityTotal: 150 });

function featured(over: Partial<HomeEvent> & { at?: Date } = {}): HomeEvent {
  const { at: when = NOW, ...rest } = over;
  const ev = rest.event ?? show;
  return {
    event: ev,
    phase: 'open',
    offer: offerSummary([general], ev, when),
    availableTotal: 112,
    coverUrl: 'https://cdn.test/events/ev-1/cover-a.png',
    ...rest,
  };
}
const hero = (item: HomeEvent, now = NOW) => html(createElement(Hero, { featured: item, now }));

describe('Hero (N7)', () => {
  it('on sale: chip with the hero dot, when/where, the phase panel with a countdown, price, both actions', () => {
    const out = hero(featured());
    expect(out).toContain('data-testid="home-hero"');
    expect(out).toContain('data-phase="open"');
    expect(out).toMatch(/<h1 id="hero-title"[^>]*>Winter Night — Dhaka<\/h1>/);
    expect(text(out)).toContain('Next show');
    // N5: the hero's chip always draws the 8px dot in its ink colour.
    expect(out).toMatch(
      /<span aria-hidden="true" class="size-2 rounded-full bg-current"><\/span>On sale</,
    );
    expect(out).toMatch(/<dt[^>]*>When<\/dt><dd[^>]*>Sat 17 Oct 2026, 19:00 \(Dhaka\)<\/dd>/);
    expect(out).toMatch(/<dt[^>]*>Where<\/dt>/);
    expect(text(out)).toContain('The Attic, Gulshan 2, Dhaka');
    expect(out).toMatch(/<strong[^>]*>On sale\.<\/strong>/);
    expect(text(out)).toContain('On sale. Registration is open until Mon 12 Oct, 23:59 (Dhaka).');
    expect(out).toContain('role="timer"');
    expect(out).toContain('aria-label="Registration closes in"');
    expect(text(out)).toContain('From ৳1,200.00');
    expect(text(out)).toContain('112 tickets left');
    expect(links(out)).toEqual([
      ['/events/winter-night-dhaka/register', 'Get tickets'],
      ['/events/winter-night-dhaka', 'Event details →'],
    ]);
    expect(out).toMatch(/<img [^>]*fetchPriority="high"[^>]*data-testid="hero-cover"/i);
    expect(out).not.toContain('loading="lazy"');
  });

  it('closing soon: says so twice (chip and sentence) and still sells', () => {
    const chattogram = event({
      ...show,
      startsAt: at('2026-10-01T13:00:00Z'), // Thu 1 Oct 19:00
      registrationClosesAt: at('2026-09-26T17:59:00Z'), // Sat 26 Sep 23:59
    });
    const now = at('2026-09-25T06:00:00Z');
    const out = hero(
      featured({ event: chattogram, phase: 'closing_soon', availableTotal: 38, at: now }),
      now,
    );
    expect(out).toContain('data-phase="closing_soon"');
    expect(out).toMatch(/bg-current"><\/span>Closing soon</);
    expect(text(out)).toContain(
      'Closing soon. Registration closes Sat 26 Sep, 23:59 (Dhaka), 5 days before the show.',
    );
    expect(out).toContain('role="timer"');
    expect(text(out)).toContain('38 tickets left');
    expect(links(out).map(([href]) => href)).toContain('/events/winter-night-dhaka/register');
  });

  it('sold out: no countdown, no price, and "Event details" is the only action', () => {
    const out = hero(featured({ phase: 'sold_out', availableTotal: 0 }));
    expect(out).toMatch(/bg-current"><\/span>Sold out</);
    expect(text(out)).toContain(
      'Sold out. Every ticket for this show has been sold or is held. If a hold expires, tickets come back on sale here.',
    );
    expect(out).not.toContain('role="timer"');
    expect(text(out)).not.toContain('From ৳');
    expect(links(out)).toEqual([['/events/winter-night-dhaka', 'Event details']]);
  });

  it('not on sale yet: the opening, the Early Bird, a countdown to the sale and the Early Bird price', () => {
    const now = at('2026-09-20T06:00:00Z');
    const opensLater = event({ ...show, registrationOpensAt: at('2026-10-01T04:00:00Z') }); // Thu 1 Oct 10:00
    const earlyBird = ticketType({
      id: 'tt-eb',
      name: 'Early Bird',
      pricePaisa: 60_000,
      salesEndsAt: at('2026-10-04T17:59:00Z'), // Sun 4 Oct 23:59
    });
    const out = hero(
      featured({
        event: opensLater,
        phase: 'not_open',
        offer: offerSummary([earlyBird, general], opensLater, now),
        availableTotal: 160,
      }),
      now,
    );
    // The hero's chip says "Not on sale yet"; the date is in the sentence.
    expect(out).toMatch(/bg-current"><\/span>Not on sale yet</);
    expect(text(out)).toContain(
      'Not on sale yet. Tickets go on sale Thu 1 Oct, 10:00 (Dhaka). Early Bird runs until Sun 4 Oct, 23:59.',
    );
    expect(out).toContain('aria-label="Tickets go on sale in"');
    expect(text(out)).toContain('From ৳600.00 · Early Bird');
    expect(text(out)).not.toContain('tickets left');
    expect(links(out)).toEqual([['/events/winter-night-dhaka', 'Event details']]);
  });

  it('registration closed: when the show starts, no countdown, no price', () => {
    const now = at('2026-10-14T06:00:00Z');
    const out = hero(featured({ phase: 'closed', availableTotal: 30, at: now }), now);
    expect(out).toMatch(/bg-current"><\/span>Registration closed</);
    expect(text(out)).toContain(
      'Closed. Registration for this show has closed. It starts Sat 17 Oct, 19:00 (Dhaka).',
    );
    expect(out).not.toContain('role="timer"');
    expect(text(out)).not.toContain('From ৳');
    expect(links(out)).toEqual([['/events/winter-night-dhaka', 'Event details']]);
  });

  it('a private venue shows the area and the lock line, never the venue (ADR-029)', () => {
    const secret = event({
      ...show,
      venue: 'Warehouse 7',
      venueHidden: true,
      venueArea: 'Banani, Dhaka',
    });
    const out = hero(featured({ event: forPublic(secret) }));
    expect(text(out)).toContain('Banani, Dhaka');
    expect(text(out)).toContain('Exact venue is sent with your tickets');
    expect(out).not.toContain('Warehouse 7');

    const noArea = event({ ...secret, venueArea: null });
    const bare = hero(featured({ event: forPublic(noArea) }));
    expect(bare).toMatch(/<dt[^>]*>Where<\/dt>/);
    expect(text(bare)).toContain('Exact venue is sent with your tickets');
  });

  it('no venue at all: no "Where" row', () => {
    const out = hero(featured({ event: event({ ...show, venue: null }) }));
    expect(out).not.toContain('>Where<');
  });

  it('no cover: the brand placeholder takes its place', () => {
    const out = hero(featured({ coverUrl: null }));
    expect(out).not.toContain('<img');
    expect(out).toContain('data-testid="cover-placeholder"');
  });
});

describe('Countdown (N6)', () => {
  const target = Date.parse('2026-10-12T17:59:00Z');

  it('splits the time left into days, hours, minutes and seconds', () => {
    const now = target - (((17 * 24 + 6) * 60 + 12) * 60 + 48) * 1000;
    expect(countdownParts(target, now)).toEqual({ days: 17, hours: 6, minutes: 12, seconds: 48 });
  });

  it('rounds a part-second up, so zero is the target itself; after it, all zero', () => {
    expect(countdownParts(target, target - 500)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 1,
    });
    expect(countdownParts(target, target)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
    expect(countdownParts(target, target + 60_000)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
  });

  it('names the timer to the minute, singular at one', () => {
    expect(
      countdownLabel('Registration closes in', { days: 17, hours: 6, minutes: 12, seconds: 48 }),
    ).toBe('Registration closes in 17 days, 6 hours, 12 minutes');
    expect(
      countdownLabel('Tickets go on sale in', { days: 1, hours: 1, minutes: 1, seconds: 0 }),
    ).toBe('Tickets go on sale in 1 day, 1 hour, 1 minute');
  });

  it('server-renders placeholder cells (no clock on the server, no hydration mismatch)', () => {
    const out = html(
      createElement(Countdown, { label: 'Registration closes in', target: '2026-10-12T17:59:00Z' }),
    );
    expect(out).toContain('role="timer"');
    expect(out).toContain('aria-live="off"');
    expect(out).toContain('print:hidden');
    expect(out.match(/>–</g)).toHaveLength(4);
    expect(text(out)).toContain('Registration closes in');
    for (const unit of ['days', 'hours', 'minutes', 'seconds']) expect(text(out)).toContain(unit);
  });
});

const past = (over: Partial<EventRecord> = {}): HomeEvent => ({
  event: event({
    id: 'ev-past',
    slug: 'monsoon-session',
    title: 'Monsoon Session',
    venue: 'Bayside Hall, Khulshi, Chattogram',
    startsAt: at('2026-08-14T13:00:00Z'),
    status: 'archived',
    ...over,
  }),
  phase: 'past',
  offer: offerSummary([], show, NOW),
  availableTotal: 0,
  coverUrl: 'https://cdn.test/events/ev-past/cover-b.png',
});

describe('DormantHero', () => {
  const dormant = (lastShow: HomeEvent | null, facebookUrl: string | null) =>
    html(createElement(DormantHero, { lastShow, facebookUrl }));

  it('between shows: the statement, Facebook, past events and the last show', () => {
    const out = dormant(past(), 'https://facebook.com/echoandaura');
    expect(out).toContain('data-testid="home-dormant"');
    expect(text(out)).toContain('Between shows');
    expect(out).toMatch(/<h1 id="dormant-title"[^>]*>No shows on sale right now\.<\/h1>/);
    expect(text(out)).toContain('New shows are posted on Facebook.');
    expect(links(out)).toEqual([
      ['https://facebook.com/echoandaura', 'Follow on Facebook (opens in a new tab)'],
      ['/archive', 'See past events →'],
      ['/events/monsoon-session', 'Last show · Aug 2026 · ChattogramMonsoon Session'],
    ]);
    expect(out).toMatch(/<a [^>]*target="_blank"/);
    expect(out).toContain('src="https://cdn.test/events/ev-past/cover-b.png"');
  });

  it('without a Facebook URL there is no Facebook button', () => {
    const out = dormant(past(), null);
    expect(text(out)).not.toContain('Follow on Facebook');
    expect(links(out).map(([href]) => href)).toEqual(['/archive', '/events/monsoon-session']);
  });

  it('with no past show: no "See past events", and the brand band holds the cover place', () => {
    const out = dormant(null, 'https://facebook.com/echoandaura');
    expect(links(out).map(([href]) => href)).toEqual(['https://facebook.com/echoandaura']);
    expect(out).toContain('data-testid="cover-placeholder"');
    expect(text(out)).not.toContain('Last show');

    const bare = dormant(null, null);
    expect(bare).not.toContain('<a ');
    expect(bare).toContain('data-testid="cover-placeholder"');
  });

  it('the last show without a city or a cover: just the month, and the brand placeholder', () => {
    const out = html(
      createElement(DormantHero, {
        lastShow: { ...past({ venue: 'The Attic' }), coverUrl: null },
        facebookUrl: null,
      }),
    );
    expect(text(out)).toContain('Last show · Aug 2026');
    expect(text(out)).not.toContain('Aug 2026 ·');
    expect(out).toContain('data-testid="cover-placeholder"');
  });
});

describe('UpcomingGrid (N8)', () => {
  const upcoming = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      featured({ event: event({ ...show, id: `ev-${i}`, slug: `show-${i}`, title: `Show ${i}` }) }),
    );
  const grid = (n: number, upcomingTotal = n + 1) =>
    html(createElement(UpcomingGrid, { events: upcoming(n), upcomingTotal }));

  it('renders nothing without other upcoming shows', () => {
    expect(grid(0)).toBe('');
  });

  it('one show: a single wide card, no link to /events', () => {
    const out = grid(1);
    expect(out).toMatch(/<h2 id="upcoming-heading"[^>]*>Also upcoming<\/h2>/);
    expect(out.match(/data-testid="event-card"/g)).toHaveLength(1);
    expect(out).toContain('lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]');
    expect(out).not.toContain('href="/events"');
  });

  it('three shows: three across from lg, still no link', () => {
    const out = grid(3);
    expect(out.match(/data-testid="event-card"/g)).toHaveLength(3);
    expect(out).toContain('lg:grid-cols-3');
    expect(out).not.toContain('lg:grid-cols-[minmax(0,7fr)');
    expect(out).not.toContain('All upcoming events');
  });

  it('five shows: the first three, and "All upcoming events (6)" (the hero included) to /events', () => {
    const out = grid(5);
    expect(out.match(/data-testid="event-card"/g)).toHaveLength(3);
    expect(text(out)).not.toContain('Show 3');
    expect(links(out)).toContainEqual(['/events', 'All upcoming events (6) →']);
  });
});

describe('HowItWorks (N9)', () => {
  it('builds the steps from the order cap, the hold and the verification promise', () => {
    const promise = 'usually within 2 hours, always the same day';
    const out = html(createElement(HowItWorks, { verificationPromise: promise }));
    expect(out).toMatch(/<h2 id="how-heading"[^>]*>How it works<\/h2>/);
    expect(text(out)).toContain('No card, no app, no queue at the gate.');
    // Each heading carries its step number for a screen reader (Safari
    // drops the list's own numbering).
    expect([...out.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map((m) => m[1])).toEqual([
      '<span class="sr-only">Step 1: </span>Register',
      '<span class="sr-only">Step 2: </span>Pay by bKash',
      '<span class="sr-only">Step 3: </span>Scanned at the door',
    ]);
    expect(out).toMatch(/^<section[^>]*><div[^>]*>.*<ol /);
    expect(text(out)).toContain(
      `up to ${MAX_TICKETS_PER_ORDER} tickets on one order, under one name. Your tickets are held for ${HOLD_HOURS} hours.`,
    );
    expect(text(out)).toContain(`A person checks it, ${promise}, and your tickets are emailed.`);
    expect(links(out)).toEqual([['/faq', 'Questions? Read the FAQ →']]);
    expect(howItWorksSteps(promise)[1].body).toContain(promise);
  });
});

describe('PastStrip (N9)', () => {
  it('renders nothing without past shows', () => {
    expect(html(createElement(PastStrip, { events: [] }))).toBe('');
  });

  it('colour covers, "MMM yyyy · City", and one row of four on desktop out of six', () => {
    const six = Array.from({ length: 6 }, (_, i) =>
      past({ id: `ev-p${i}`, slug: `past-${i}`, title: `Past ${i}` }),
    );
    six[1] = past({ id: 'ev-room', slug: 'room', title: 'Room only', venue: 'The Attic' });
    const out = html(createElement(PastStrip, { events: six }));
    expect(links(out)[0]).toEqual(['/archive', 'See all past events →']);
    expect(text(out)).toContain('Aug 2026 · Chattogram');
    expect(out).toMatch(/Room only<\/span><span[^>]*>Aug 2026<\/span>/);
    expect(out).not.toContain('grayscale');
    expect(out.match(/<li class="[^"]*lg:hidden/g)).toHaveLength(2);
    expect(out).toContain('snap-x');
  });
});

describe('FollowBlock (N9)', () => {
  it('links to the Facebook page in a new tab', () => {
    const out = html(
      createElement(FollowBlock, { facebookUrl: 'https://facebook.com/echoandaura' }),
    );
    expect(out).toMatch(/<h2 id="follow-heading"[^>]*>Follow for new shows<\/h2>/);
    expect(text(out)).toContain('There is no mailing list to join.');
    expect(links(out)).toEqual([
      ['https://facebook.com/echoandaura', 'Follow on Facebook (opens in a new tab)'],
    ]);
    expect(out).toContain('target="_blank"');
  });
});

describe('HomePage (H1)', () => {
  const settings = (over: Partial<SiteSettings> = {}): SiteSettings => ({
    bkashReceiveNumber: null,
    bkashAccountName: null,
    bkashAccountType: 'personal',
    supportEmail: null,
    supportPhone: null,
    facebookPageUrl: 'https://facebook.com/echoandaura',
    verificationPromise: 'usually within 4 hours, always within a day',
    organizerName: 'Raj',
    organizerAddress: null,
    updatedAt: null,
    updatedBy: null,
    ...over,
  });
  const page = async () => html(await HomePage());
  /** Where each section's heading sits in the markup; -1 when absent. */
  const order = (out: string, ids: string[]) => ids.map((id) => out.indexOf(`id="${id}"`));

  beforeEach(() => {
    getSettings.mockResolvedValue(settings());
    listPublic.mockResolvedValue([]);
  });

  it('with a show: hero, also upcoming, how it works, past, follow — in that order, in one main', async () => {
    getHomePage.mockResolvedValue({
      featured: featured(),
      alsoUpcoming: [featured({ event: event({ ...show, id: 'ev-2', slug: 'late-set' }) })],
      upcomingTotal: 2,
      past: [past()],
    });
    const out = await page();
    expect(out.match(/<main /g)).toHaveLength(1);
    expect(out).toContain('<main class="home-page ');
    // React hoists a preload for the high-priority hero cover.
    expect(out).toMatch(
      /<link rel="preload" as="image" href="[^"]*cover-a\.png" fetchPriority="high"/,
    );
    const positions = order(out, [
      'hero-title',
      'upcoming-heading',
      'how-heading',
      'past-heading',
      'follow-heading',
    ]);
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(out).not.toContain('data-testid="home-dormant"');
  });

  it('between shows: the dormant band leads, and the follow block is not repeated', async () => {
    getHomePage.mockResolvedValue({
      featured: null,
      alsoUpcoming: [],
      upcomingTotal: 0,
      past: [past()],
    });
    const out = await page();
    expect(out).toContain('data-testid="home-dormant"');
    expect(order(out, ['upcoming-heading', 'follow-heading'])).toEqual([-1, -1]);
    expect(out).toContain('id="how-heading"');
    expect(out).toContain('id="past-heading"');
  });

  it('no Facebook URL: no follow block even with a show on', async () => {
    getSettings.mockResolvedValue(settings({ facebookPageUrl: null }));
    getHomePage.mockResolvedValue({
      featured: featured(),
      alsoUpcoming: [],
      upcomingTotal: 1,
      past: [],
    });
    const out = await page();
    expect(out).toContain('id="hero-title"');
    expect(order(out, ['upcoming-heading', 'past-heading', 'follow-heading'])).toEqual([
      -1, -1, -1,
    ]);
  });
});
