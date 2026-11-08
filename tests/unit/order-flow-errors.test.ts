import { describe, expect, it } from 'vitest';
import { paymentBanner } from '@/app/(public)/orders/[id]/errors';
import { promoFieldError, registerBanner } from '@/app/(public)/events/[slug]/register/errors';
import {
  EventNotFoundError,
  HoldLapsedError,
  InvalidQuantityError,
  OrderStatusConflictError,
  RegistrationClosedError,
  SoldOutError,
  TicketTypeNotFoundError,
  TicketTypeNotOnSaleError,
  TooManyOpenOrdersError,
  TrxIdAlreadyUsedError,
} from '@/server/lib/errors';
import { HOLD_MINUTES } from '@/server/lib/hold';

/** L3: a refused order or payment as a code the page words; every branch. */
describe('registerBanner', () => {
  it('one ticket refused: sold out, naming the type so the form disables it', () => {
    expect(registerBanner(new SoldOutError('tt-1', 1))).toEqual({
      code: 'soldOutOne',
      soldOutTicketTypeId: 'tt-1',
    });
  });

  it('several refused: "not that many", and the type stays choosable', () => {
    expect(registerBanner(new SoldOutError('tt-1', 3))).toEqual({ code: 'soldOutMany' });
  });

  it('a closed window or a missing event reads as "not open"', () => {
    expect(registerBanner(new RegistrationClosedError('past'))).toEqual({ code: 'closed' });
    expect(registerBanner(new EventNotFoundError('x'))).toEqual({ code: 'closed' });
  });

  it('a type outside its sales window, or not this event’s, is "not on sale"', () => {
    expect(registerBanner(new TicketTypeNotOnSaleError('tt-1', 'closed'))).toEqual({
      code: 'notOnSale',
    });
    expect(registerBanner(new TicketTypeNotFoundError('tt-1'))).toEqual({ code: 'notOnSale' });
  });

  it('the open-orders cap carries the limit and the hold length for the sentence', () => {
    expect(registerBanner(new TooManyOpenOrdersError(2))).toEqual({
      code: 'tooManyOpen',
      values: { limit: 2, minutes: HOLD_MINUTES },
    });
  });

  it('a bad quantity, and anything else is an outage — never the buyer’s fault', () => {
    expect(registerBanner(new InvalidQuantityError(11))).toEqual({
      code: 'quantity',
      values: { min: 1, max: 10 },
    });
    expect(registerBanner(new Error('db down'))).toEqual({ code: 'unexpected' });
    expect(registerBanner('a string')).toEqual({ code: 'unexpected' });
  });
});

describe('promoFieldError', () => {
  it('an unknown code is "not valid"; one for another type, or one making it free, "does not apply"', () => {
    expect(promoFieldError('unknown')).toEqual({ code: 'promoInvalid' });
    expect(promoFieldError('not_for_ticket_type')).toEqual({ code: 'promoNotForType' });
    expect(promoFieldError('makes_ticket_free')).toEqual({ code: 'promoNotForType' });
  });
});

describe('paymentBanner', () => {
  it('a trxID on another order is its own answer (Invariant 3)', () => {
    expect(paymentBanner(new TrxIdAlreadyUsedError('9AB12CD34E'))).toBe('trxIdUsed');
  });

  it('a lapsed hold, by the clock or by the expiry job, says the hold expired', () => {
    expect(paymentBanner(new HoldLapsedError('o-1'))).toBe('holdExpired');
    expect(paymentBanner(new OrderStatusConflictError('o-1', 'expired'))).toBe('holdExpired');
  });

  it('any other status can no longer take a trxID', () => {
    expect(paymentBanner(new OrderStatusConflictError('o-1', 'rejected'))).toBe('noLongerAccepts');
    expect(paymentBanner(new OrderStatusConflictError('o-1', 'issued'))).toBe('noLongerAccepts');
  });

  it('anything else is an outage', () => {
    expect(paymentBanner(new Error('db down'))).toBe('unexpected');
  });
});
