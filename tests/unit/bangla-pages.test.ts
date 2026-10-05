import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { offerSummary } from '@/server/lib/event-offer';
import { heroCopy } from '@/server/lib/hero-copy';
import { phaseChipLabel } from '@/lib/phase-chip-label';
import { buildEventMetadata, buildHomeMetadata } from '@/lib/seo';
import { formatDhakaDate, formatDhakaDayMonth, formatDhakaMonth } from '@/lib/time';
import { SiteFooter } from '@/components/public/site-shell';
import { countdownLabel } from '@/app/(public)/home/countdown';
import { howItWorksSteps } from '@/app/(public)/home/how-it-works';
import { useTestLocale } from './setup/intl';

/**
 * ADR-061 (L2): the public pages in Bangla. The English output is pinned by
 * the existing suites, unchanged; this checks the Bangla side — words,
 * Bangla digits, lakh grouping, the time of day.
 */
const at = (iso: string) => new Date(iso);
const event = {
  startsAt: at('2026-10-17T13:00:00Z'), // Sat 17 Oct 7:00 PM Dhaka
  registrationOpensAt: at('2026-09-27T04:00:00Z'),
  registrationClosesAt: at('2026-10-12T17:59:00Z'), // Mon 12 Oct 11:59 PM
};
const general = {
  id: 'gen',
  name: 'General',
  pricePaisa: 120_000,
  quantityTotal: 2000,
  quantitySold: 0,
  quantityReserved: 0,
  salesStartsAt: null,
  salesEndsAt: null,
};

afterEach(() => useTestLocale('en'));

describe('Bangla public pages (ADR-061)', () => {
  it('the hero speaks Bangla, with Bangla digits and the part of the day', () => {
    const now = at('2026-10-05T06:00:00Z');
    const copy = heroCopy({
      phase: 'open',
      event,
      offer: offerSummary([general], event, now),
      availableTotal: 1234,
      now,
      locale: 'bn',
    });
    expect(copy.phaseWord).toBe('বিক্রি চলছে।');
    expect(copy.sentence).toBe(
      'রেজিস্ট্রেশন খোলা থাকবে সোম, ১২ অক্টোবর, রাত ১১:৫৯ (ঢাকা) পর্যন্ত।',
    );
    expect(copy.priceLabel).toBe('৳১,২০০.০০ থেকে');
    expect(copy.leftLabel).toBe('১,২৩৪টি টিকিট বাকি');
    expect(copy.countdown?.label).toBe('রেজিস্ট্রেশন বন্ধ হতে বাকি');
  });

  it('closing soon counts Dhaka days in Bangla', () => {
    const now = at('2026-10-11T06:00:00Z');
    const copy = heroCopy({
      phase: 'closing_soon',
      event,
      offer: offerSummary([general], event, now),
      availableTotal: 5,
      now,
      locale: 'bn',
    });
    expect(copy.sentence).toBe(
      'রেজিস্ট্রেশন বন্ধ হবে সোম, ১২ অক্টোবর, রাত ১১:৫৯ (ঢাকা), শো-এর ৫ দিন আগে।',
    );
  });

  it('chips, dates, the countdown and the steps', () => {
    expect(
      phaseChipLabel('not_open', {
        registrationOpensAt: event.registrationOpensAt,
        earlyBirdOnSale: false,
        variant: 'card',
        locale: 'bn',
      }).label,
    ).toBe('বিক্রি শুরু ২৭ সেপ্টেম্বর');
    expect(formatDhakaDate(event.startsAt, 'bn')).toBe('শনিবার, ১৭ অক্টোবর ২০২৬');
    expect(formatDhakaMonth(event.startsAt, 'bn')).toBe('অক্টোবর ২০২৬');
    expect(formatDhakaDayMonth(event.startsAt, 'bn')).toBe('১৭ অক্টোবর');
    expect(formatDhakaDate(event.startsAt)).toBe('Sat 17 Oct 2026');
    expect(countdownLabel('বাকি', { days: 2, hours: 3, minutes: 4, seconds: 5 }, 'bn')).toBe(
      'বাকি ২ দিন, ৩ ঘণ্টা, ৪ মিনিট',
    );
    expect(howItWorksSteps('সাধারণত ৪ ঘণ্টার মধ্যে', 'bn')[0]?.body).toContain('সর্বোচ্চ ১০টি');
  });

  it('share text and og:locale in Bangla; English unchanged', () => {
    const meta = buildEventMetadata({
      event: {
        slug: 'live',
        title: 'Live',
        description: null,
        venue: 'ICCB Hall 4, Dhaka',
        venueHidden: false,
        venueArea: null,
        startsAt: event.startsAt,
      },
      coverUrl: null,
      fromPricePaisa: 80_000,
      siteUrl: 'https://x.test',
      locale: 'bn',
    });
    expect(meta.description).toBe(
      'শনিবার, ১৭ অক্টোবর ২০২৬, সন্ধ্যা ৭:০০ (ঢাকা) · ICCB Hall 4, Dhaka · টিকিট ৳৮০০.০০ থেকে',
    );
    expect(meta.openGraph?.locale).toBe('bn_BD');
    expect(meta.alternates?.canonical).toBe('https://x.test/bn/events/live');
    const home = buildHomeMetadata({ featured: null, siteUrl: 'https://x.test' });
    expect(home.alternates?.canonical).toBe('https://x.test');
    expect(home.openGraph?.locale).toBe('en_GB');
  });

  it('the footer renders in Bangla', () => {
    useTestLocale('bn');
    const html = renderToStaticMarkup(
      createElement(SiteFooter, {
        account: { href: '/account/sign-in', key: 'signIn', label: 'Sign in', signedIn: false },
        settings: { facebookPageUrl: null, supportEmail: null },
      }),
    );
    expect(html).toContain('সামনের ইভেন্ট');
    expect(html).toContain('সাইন ইন');
    expect(html).toMatch(/© [০-৯]{4} echoandaura · ঢাকা, বাংলাদেশ/);
    expect(html).toContain('id="footer-tickets"');
  });
});
