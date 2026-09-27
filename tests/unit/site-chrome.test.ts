import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfferSummary } from '@/server/lib/event-offer';
import type { HomeEvent } from '@/server/services/events.service';
import { event } from './helpers/fake-db';

// The header's two client pieces read the path; the test sets it per case.
let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const getHomePage = vi.fn();
vi.mock('@/server/container', () => ({ eventsService: { getHomePage } }));

const { SiteFooter, SiteHeader } = await import('@/components/public/site-shell');
const { featuredCta } = await import('@/app/(public)/home/load');
const { accountLink } = await import('@/lib/public-nav');

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const cta = { slug: 'echo-aura-live', title: 'Echo & Aura Live', dateLabel: 'Sat 17 Oct 2026' };
const header = (over: Partial<Parameters<typeof SiteHeader>[0]> = {}) =>
  html(
    createElement(SiteHeader, {
      cta: null,
      account: accountLink(false),
      facebook: null,
      ...over,
    }),
  );
const footer = (over: Partial<Parameters<typeof SiteFooter>[0]> = {}) =>
  html(
    createElement(SiteFooter, {
      account: accountLink(false),
      settings: { facebookPageUrl: null, supportEmail: null },
      ...over,
    }),
  );

/** The markup of one `<nav>`, found by the id of the heading that names it. */
const footerNav = (out: string, id: string) => {
  const match = out.match(new RegExp(`<nav aria-labelledby="${id}"[^>]*>(.*?)</nav>`));
  if (!match) throw new Error(`no nav ${id}`);
  return match[1];
};
const hrefs = (markup: string) => [...markup.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

describe('SiteHeader (N1–N3)', () => {
  beforeEach(() => {
    pathname = '/';
  });

  it('is dark on the home page, light elsewhere, and scoped for the focus ring', () => {
    expect(header()).toMatch(/<header data-tone="dark" class="site-chrome group /);
    pathname = '/faq';
    expect(header()).toMatch(/<header data-tone="light"/);
  });

  it('marks the current section only; nothing on the home page', () => {
    expect(header()).not.toContain('aria-current');
    pathname = '/faq';
    const out = header();
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(
      /<a aria-current="page" [^>]*href="\/faq"|<a [^>]*href="\/faq"[^>]*aria-current="page"/,
    );
    pathname = '/events/echo-aura-live/register';
    expect(header()).toMatch(
      /href="\/events"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/events"/,
    );
  });

  it('keeps the desktop landmark named "Site" with the four links, then the account', () => {
    const out = header();
    const nav = out.match(/<nav aria-label="Site"[^>]*>(.*?)<\/nav>/)?.[1] ?? '';
    expect(hrefs(nav)).toEqual(['/events', '/archive', '/faq', '/contact', '/account/sign-in']);
    expect(nav).toContain('Sign in');
    expect(nav).not.toContain('<svg');
  });

  it('shows "Get tickets" at both widths only while the featured event is buyable', () => {
    expect(header()).not.toContain('Get tickets');
    const out = header({ cta });
    expect(out.match(/href="\/events\/echo-aura-live\/register"/g)).toHaveLength(2);
    expect(out.match(/>Get tickets</g)).toHaveLength(2);
  });

  it('signed in: "My orders" with the person icon', () => {
    const out = header({ account: accountLink(true) });
    expect(out).toMatch(
      /href="\/account"[^>]*><svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg>My orders/,
    );
    expect(out).not.toContain('Sign in');
  });

  it('has a closed menu button on phones', () => {
    const out = header();
    expect(out).toMatch(/<button[^>]*aria-label="Open menu"/);
    expect(out).toMatch(/aria-expanded="false"/);
    // The dialog is not rendered until opened.
    expect(out).not.toContain('Nothing is on sale right now.');
  });
});

describe('SiteFooter (N12)', () => {
  it('groups the links into named navs, each headed by an h2', () => {
    const out = footer();
    for (const [id, title] of [
      ['footer-tickets', 'Tickets'],
      ['footer-about', 'About'],
      ['footer-help', 'Help'],
    ]) {
      expect(out).toContain(`<h2 id="${id}"`);
      expect(out).toMatch(new RegExp(`<h2 id="${id}"[^>]*>${title}</h2>`));
    }
    expect(hrefs(footerNav(out, 'footer-tickets'))).toEqual([
      '/events',
      '/archive',
      '/orders/find',
      '/account/sign-in',
    ]);
    expect(hrefs(footerNav(out, 'footer-about'))).toEqual(['/about', '/contact']);
    expect(hrefs(footerNav(out, 'footer-help'))).toEqual(['/faq', '/refund']);
    const legal = out.match(/<nav aria-label="Legal"[^>]*>(.*?)<\/nav>/)?.[1] ?? '';
    expect(hrefs(legal)).toEqual(['/terms', '/privacy', '/refund']);
    expect(legal).toContain('Privacy policy');
  });

  it('adds Facebook and the support email only when they are set', () => {
    const out = footer({
      account: accountLink(true),
      settings: { facebookPageUrl: 'https://facebook.com/echoandaura', supportEmail: 'hi@x.test' },
    });
    const about = footerNav(out, 'footer-about');
    expect(about).toMatch(
      /href="https:\/\/facebook.com\/echoandaura" target="_blank" rel="noreferrer"/,
    );
    expect(about).toContain('(opens in a new tab)');
    expect(hrefs(footerNav(out, 'footer-help'))).toContain('mailto:hi@x.test');
    expect(hrefs(footerNav(out, 'footer-tickets'))).toContain('/account');
    expect(footerNav(out, 'footer-tickets')).toContain('My orders');
  });

  it('carries the trust line, the Dhaka line, and the sponsor row when given', () => {
    const out = footer({ sponsorRow: createElement('div', { 'data-testid': 'sponsor-row' }) });
    expect(out).toContain('Payments by bKash · verified by a person · no refunds through the app');
    expect(out).toMatch(/© \d{4} echoandaura · Dhaka, Bangladesh/);
    expect(out).toMatch(/class="site-chrome [^"]*print:hidden/);
    // Between the columns and the legal line.
    expect(out.indexOf('data-testid="sponsor-row"')).toBeGreaterThan(out.indexOf('footer-help'));
    expect(out.indexOf('data-testid="sponsor-row"')).toBeLessThan(
      out.indexOf('aria-label="Legal"'),
    );
  });
});

describe('featuredCta', () => {
  const offer: OfferSummary = {
    fromPricePaisa: 60_000,
    fromTypeName: 'General',
    fromIsEarlyBird: false,
    earlyBird: null,
    earlyBirdOnSale: false,
    highlightId: null,
  };
  const featured = (phase: HomeEvent['phase']): HomeEvent => ({
    event: event({
      slug: 'echo-aura-live',
      title: 'Echo & Aura Live',
      // Sat 17 Oct 2026, 01:00 in Dhaka — still Friday in UTC.
      startsAt: new Date('2026-10-16T19:00:00Z'),
    }),
    phase,
    offer,
    availableTotal: 100,
    coverUrl: null,
  });
  const home = (item: HomeEvent | null) => ({
    featured: item,
    alsoUpcoming: [],
    upcomingTotal: item ? 1 : 0,
    past: [],
  });

  it('names the buyable featured event with its Dhaka date', async () => {
    for (const phase of ['open', 'closing_soon'] as const) {
      getHomePage.mockResolvedValueOnce(home(featured(phase)));
      await expect(featuredCta()).resolves.toEqual(cta);
    }
  });

  it('is null when nothing is buyable', async () => {
    getHomePage.mockResolvedValueOnce(home(null));
    await expect(featuredCta()).resolves.toBeNull();
    for (const phase of ['not_open', 'sold_out', 'closed', 'past'] as const) {
      getHomePage.mockResolvedValueOnce(home(featured(phase)));
      await expect(featuredCta()).resolves.toBeNull();
    }
  });
});
