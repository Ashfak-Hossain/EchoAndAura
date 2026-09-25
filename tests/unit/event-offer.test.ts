import { describe, expect, it } from 'vitest';
import { type OfferTicketType, offerSummary } from '@/server/lib/event-offer';

/**
 * Plan decision 5: one Early Bird rule for the home page and the event
 * page. Times are UTC; the comments give Dhaka wall time (UTC+6).
 */
const at = (iso: string) => new Date(iso);

const event = {
  registrationOpensAt: at('2026-09-27T04:00:00Z'), // Sun 27 Sep 10:00
  registrationClosesAt: at('2026-10-12T17:59:00Z'), // Mon 12 Oct 23:59
};
const EB_ENDS = at('2026-10-04T17:59:00Z'); // Sun 4 Oct 23:59

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

const earlyBird = type({
  id: 'eb',
  name: 'Early Bird',
  pricePaisa: 60_000,
  quantityTotal: 50,
  salesEndsAt: EB_ENDS,
});
// General opens as the Early Bird ends and runs to the close.
const general = type({ id: 'gen', salesStartsAt: EB_ENDS });
const vip = type({ id: 'vip', name: 'VIP', pricePaisa: 300_000, quantityTotal: 20 });
const types = [earlyBird, general, vip];

const DURING_EB = at('2026-10-01T06:00:00Z');
const AFTER_EB = at('2026-10-06T06:00:00Z');
const BEFORE_OPEN = at('2026-09-20T06:00:00Z');

describe('offerSummary', () => {
  it('Early Bird on sale: it is the from-price, the chip and the highlighted row', () => {
    expect(offerSummary(types, event, DURING_EB)).toEqual({
      fromPricePaisa: 60_000,
      fromTypeName: 'Early Bird',
      fromIsEarlyBird: true,
      earlyBird: { id: 'eb', name: 'Early Bird', salesEndsAt: EB_ENDS },
      earlyBirdOnSale: true,
      highlightId: 'eb',
    });
  });

  it('Early Bird sold out: the from-price falls to the next type still available', () => {
    const soldOut = { ...earlyBird, quantitySold: 45, quantityReserved: 5 };
    expect(offerSummary([soldOut, general, vip], event, DURING_EB)).toEqual({
      fromPricePaisa: 120_000,
      fromTypeName: 'General',
      fromIsEarlyBird: false,
      earlyBird: null,
      earlyBirdOnSale: false,
      highlightId: null,
    });
  });

  it('Early Bird window ended: same, with nothing highlighted', () => {
    expect(offerSummary(types, event, AFTER_EB)).toMatchObject({
      fromPricePaisa: 120_000,
      fromTypeName: 'General',
      fromIsEarlyBird: false,
      earlyBird: null,
      earlyBirdOnSale: false,
      highlightId: null,
    });
  });

  it('before registration opens: the Early Bird is named and quoted, but not "on sale"', () => {
    expect(offerSummary(types, event, BEFORE_OPEN)).toEqual({
      fromPricePaisa: 60_000,
      fromTypeName: 'Early Bird',
      fromIsEarlyBird: true,
      earlyBird: { id: 'eb', name: 'Early Bird', salesEndsAt: EB_ENDS },
      earlyBirdOnSale: false,
      highlightId: null,
    });
  });

  it('an Early Bird whose own sales start later is named but not on sale', () => {
    const later = { ...earlyBird, salesStartsAt: at('2026-10-02T04:00:00Z') };
    expect(offerSummary([later, general, vip], event, DURING_EB)).toMatchObject({
      earlyBird: { id: 'eb' },
      earlyBirdOnSale: false,
      highlightId: null,
    });
  });

  it('a single ticket type: its price, no Early Bird, nothing to highlight', () => {
    const only = type({ id: 'only', pricePaisa: 80_000, salesEndsAt: EB_ENDS });
    expect(offerSummary([only], event, DURING_EB)).toEqual({
      fromPricePaisa: 80_000,
      fromTypeName: 'General',
      fromIsEarlyBird: false,
      earlyBird: null,
      earlyBirdOnSale: false,
      highlightId: null,
    });
  });

  it('no ticket types: nothing to quote', () => {
    expect(offerSummary([], event, DURING_EB)).toEqual({
      fromPricePaisa: null,
      fromTypeName: null,
      fromIsEarlyBird: false,
      earlyBird: null,
      earlyBirdOnSale: false,
      highlightId: null,
    });
  });

  it('from-price fallback: nothing left anywhere → the cheapest of all types, not labelled Early Bird', () => {
    const gone = types.map((t) => ({ ...t, quantitySold: t.quantityTotal }));
    expect(offerSummary(gone, event, DURING_EB)).toMatchObject({
      fromPricePaisa: 60_000,
      fromTypeName: 'Early Bird',
      fromIsEarlyBird: false,
      earlyBird: null,
      highlightId: null,
    });
  });

  it('a type that ends early but costs more is not an Early Bird', () => {
    const vipPresale = type({
      id: 'pre',
      name: 'VIP presale',
      pricePaisa: 250_000,
      salesEndsAt: EB_ENDS,
    });
    expect(offerSummary([vipPresale, general], event, DURING_EB)).toMatchObject({
      earlyBird: null,
      earlyBirdOnSale: false,
      highlightId: null,
      // General opens later but still counts as available; it is the cheapest.
      fromPricePaisa: 120_000,
      fromIsEarlyBird: false,
    });
  });

  it('a cheaper type that sells until the close is not an Early Bird either', () => {
    const toClose = { ...earlyBird, salesEndsAt: event.registrationClosesAt };
    expect(offerSummary([toClose, general], event, DURING_EB).earlyBird).toBeNull();
  });

  it('without a registration close there is nothing to end "early", so no Early Bird', () => {
    expect(
      offerSummary(types, { ...event, registrationClosesAt: null }, DURING_EB).earlyBird,
    ).toBeNull();
  });

  it('several Early Bird tiers: the one ending first is named, then the next', () => {
    const superEarly = type({
      id: 'super',
      name: 'Super Early Bird',
      pricePaisa: 50_000,
      quantityTotal: 10,
      salesEndsAt: at('2026-10-02T17:59:00Z'),
    });
    expect(offerSummary([superEarly, ...types], event, DURING_EB)).toMatchObject({
      earlyBird: { id: 'super' },
      fromPricePaisa: 50_000,
      fromTypeName: 'Super Early Bird',
      highlightId: 'super',
    });
    const superGone = { ...superEarly, quantitySold: 10 };
    expect(offerSummary([superGone, ...types], event, DURING_EB)).toMatchObject({
      earlyBird: { id: 'eb' },
      fromPricePaisa: 60_000,
      highlightId: 'eb',
    });
  });

  it('equal prices keep the admin order', () => {
    const a = type({ id: 'a', name: 'Standing' });
    const b = type({ id: 'b', name: 'Seated' });
    expect(offerSummary([a, b], event, DURING_EB).fromTypeName).toBe('Standing');
  });
});
