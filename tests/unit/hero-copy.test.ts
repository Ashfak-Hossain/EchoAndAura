import { describe, expect, it } from 'vitest';
import { type OfferTicketType, offerSummary } from '@/server/lib/event-offer';
import { COUNTDOWN_LABELS, type HeroCopyInput, heroCopy } from '@/server/lib/hero-copy';

/**
 * The hero's signed-off wording (Canvas 6 plan, "Wording to sign off"),
 * phase by phase at fixed instants. Times are UTC; comments give Dhaka
 * wall time (UTC+6). Times print 24-hour, as everywhere else on the site.
 */
const at = (iso: string) => new Date(iso);

const event = {
  startsAt: at('2026-10-17T13:00:00Z'), // Sat 17 Oct 19:00
  registrationOpensAt: at('2026-09-27T04:00:00Z'), // Sun 27 Sep 10:00
  registrationClosesAt: at('2026-10-12T17:59:00Z'), // Mon 12 Oct 23:59
};

function type(over: Partial<OfferTicketType> & { id: string }): OfferTicketType {
  return {
    name: 'General',
    pricePaisa: 120_000,
    quantityTotal: 100,
    quantitySold: 0,
    quantityReserved: 0,
    salesStartsAt: null,
    salesEndsAt: null,
    ...over,
  };
}

const general = type({ id: 'gen' });
const noOffer = offerSummary([general], event, at('2026-10-05T06:00:00Z'));

function copy(over: Partial<HeroCopyInput> & Pick<HeroCopyInput, 'phase' | 'now'>) {
  return heroCopy({ event, offer: noOffer, availableTotal: 112, ...over });
}

describe('heroCopy', () => {
  it('open: until the close, counting down to it, with price and tickets left', () => {
    const now = at('2026-10-05T06:00:00Z');
    expect(copy({ phase: 'open', now })).toEqual({
      phaseWord: 'On sale.',
      sentence: 'Registration is open until Mon 12 Oct, 23:59 (Dhaka).',
      countdown: { label: 'Registration closes in', target: event.registrationClosesAt },
      priceLabel: 'From ৳1,200.00',
      leftLabel: '112 tickets left',
      canBuy: true,
    });
  });

  it('closing soon: the close, and how many days before the show it falls', () => {
    // The canvas example: closes Sat 26 Sep 23:59, show Thu 1 Oct 19:00.
    const chattogram = {
      startsAt: at('2026-10-01T13:00:00Z'),
      registrationOpensAt: at('2026-09-11T04:00:00Z'),
      registrationClosesAt: at('2026-09-26T17:59:00Z'),
    };
    const now = at('2026-09-25T12:00:00Z');
    expect(copy({ phase: 'closing_soon', event: chattogram, availableTotal: 38, now })).toEqual({
      phaseWord: 'Closing soon.',
      sentence: 'Registration closes Sat 26 Sep, 23:59 (Dhaka), 5 days before the show.',
      countdown: { label: 'Registration closes in', target: chattogram.registrationClosesAt },
      priceLabel: 'From ৳1,200.00',
      leftLabel: '38 tickets left',
      canBuy: true,
    });
  });

  it('closing soon: the day count is Dhaka calendar days, singular at one, gone at zero', () => {
    const now = at('2026-10-10T06:00:00Z');
    const closing = (registrationClosesAt: Date) =>
      copy({ phase: 'closing_soon', event: { ...event, registrationClosesAt }, now }).sentence;
    // 00:30 on Tue 13 Oct in Dhaka is still Mon 12 Oct in UTC: 4 days, not 5.
    expect(closing(at('2026-10-12T18:30:00Z'))).toBe(
      'Registration closes Tue 13 Oct, 00:30 (Dhaka), 4 days before the show.',
    );
    expect(closing(at('2026-10-16T17:59:00Z'))).toBe(
      'Registration closes Fri 16 Oct, 23:59 (Dhaka), 1 day before the show.',
    );
    expect(closing(at('2026-10-17T06:00:00Z'))).toBe(
      'Registration closes Sat 17 Oct, 12:00 (Dhaka).',
    );
  });

  it('not on sale yet: when sales start, and until when the Early Bird runs', () => {
    const now = at('2026-09-20T06:00:00Z');
    const opensLater = { ...event, registrationOpensAt: at('2026-10-01T04:00:00Z') }; // Thu 1 Oct 10:00
    const earlyBird = type({
      id: 'eb',
      name: 'Early Bird',
      pricePaisa: 60_000,
      salesEndsAt: at('2026-10-04T17:59:00Z'), // Sun 4 Oct 23:59
    });
    const offer = offerSummary([earlyBird, general], opensLater, now);
    expect(copy({ phase: 'not_open', event: opensLater, offer, availableTotal: 200, now })).toEqual(
      {
        phaseWord: 'Not on sale yet.',
        sentence:
          'Tickets go on sale Thu 1 Oct, 10:00 (Dhaka). Early Bird runs until Sun 4 Oct, 23:59.',
        countdown: { label: 'Tickets go on sale in', target: opensLater.registrationOpensAt },
        priceLabel: 'From ৳600.00 · Early Bird',
        leftLabel: null,
        canBuy: false,
      },
    );
  });

  it('not on sale yet: the Early Bird is named as the organizer named it; none → one sentence', () => {
    const now = at('2026-09-20T06:00:00Z');
    const earlyBird = type({
      id: 'eb',
      name: 'Early-bird (first 50)',
      pricePaisa: 60_000,
      salesEndsAt: at('2026-10-04T17:59:00Z'),
    });
    const named = copy({
      phase: 'not_open',
      offer: offerSummary([earlyBird, general], event, now),
      now,
    });
    expect(named.sentence).toBe(
      'Tickets go on sale Sun 27 Sep, 10:00 (Dhaka). Early-bird (first 50) runs until Sun 4 Oct, 23:59.',
    );
    expect(named.priceLabel).toBe('From ৳600.00 · Early-bird (first 50)');

    const plain = copy({ phase: 'not_open', now });
    expect(plain.sentence).toBe('Tickets go on sale Sun 27 Sep, 10:00 (Dhaka).');
    expect(plain.priceLabel).toBe('From ৳1,200.00');
  });

  it('not on sale yet with no opening date: no countdown, no promise', () => {
    const now = at('2026-09-20T06:00:00Z');
    expect(
      copy({ phase: 'not_open', event: { ...event, registrationOpensAt: null }, now }),
    ).toMatchObject({
      phaseWord: 'Not on sale yet.',
      sentence: 'Sale dates have not been announced yet.',
      countdown: null,
      canBuy: false,
    });
  });

  it('sold out: holds can expire, so the sentence says so; no countdown, no price', () => {
    const now = at('2026-10-05T06:00:00Z');
    expect(copy({ phase: 'sold_out', availableTotal: 0, now })).toEqual({
      phaseWord: 'Sold out.',
      sentence:
        'Every ticket for this show has been sold or is held. If a hold expires, tickets come back on sale here.',
      countdown: null,
      priceLabel: null,
      leftLabel: null,
      canBuy: false,
    });
  });

  it('registration closed: when the show starts; no countdown, no price', () => {
    const now = at('2026-10-14T06:00:00Z');
    expect(copy({ phase: 'closed', availableTotal: 30, now })).toEqual({
      phaseWord: 'Closed.',
      sentence: 'Registration for this show has closed. It starts Sat 17 Oct, 19:00 (Dhaka).',
      countdown: null,
      priceLabel: null,
      leftLabel: null,
      canBuy: false,
    });
  });

  it('past (never featured, but total): a plain past-tense line', () => {
    const now = at('2026-10-20T06:00:00Z');
    expect(copy({ phase: 'past', now })).toEqual({
      phaseWord: 'Past.',
      sentence: 'This show was on Sat 17 Oct, 19:00 (Dhaka).',
      countdown: null,
      priceLabel: null,
      leftLabel: null,
      canBuy: false,
    });
  });

  it('tickets left: singular at one, grouped past a thousand', () => {
    const now = at('2026-10-05T06:00:00Z');
    expect(copy({ phase: 'open', availableTotal: 1, now }).leftLabel).toBe('1 ticket left');
    expect(copy({ phase: 'open', availableTotal: 1200, now }).leftLabel).toBe('1,200 tickets left');
  });

  it('no ticket types: no price line', () => {
    const now = at('2026-10-05T06:00:00Z');
    const offer = offerSummary([], event, now);
    expect(copy({ phase: 'open', offer, now }).priceLabel).toBeNull();
  });

  it('never counts down to a moment already passed', () => {
    const now = at('2026-10-12T18:00:00Z'); // a minute after the close
    expect(copy({ phase: 'open', now }).countdown).toBeNull();
  });

  it('exposes the countdown labels', () => {
    expect(COUNTDOWN_LABELS).toEqual({
      close: 'Registration closes in',
      open: 'Tickets go on sale in',
    });
  });
});
