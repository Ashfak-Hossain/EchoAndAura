import { describe, expect, it } from 'vitest';
import { percentOfPaisa } from '@/server/lib/money';
import { computeOrderTotals } from '@/server/lib/pricing';
import {
  describePromo,
  judgePromo,
  normalisePromoCode,
  promoAppliesTo,
  promoDiscountPaisa,
  promoDiscountPerTicket,
} from '@/server/lib/promo';
import { registrationFormSchema } from '@/lib/validation/orders';
import { promoCheckSchema, promoCodeFormSchema } from '@/lib/validation/promo-codes';

/** B10 pure rules: every money figure is integer paisa and never over-discounts. */
describe('percentOfPaisa', () => {
  it('floors to a whole paisa — never a rounding paisa more than offered', () => {
    expect(percentOfPaisa(120_000, 15)).toBe(18_000);
    expect(percentOfPaisa(79_950, 15)).toBe(11_992); // 11,992.5 → 11,992
    expect(percentOfPaisa(99, 50)).toBe(49);
    expect(percentOfPaisa(120_000, 100)).toBe(120_000);
    expect(percentOfPaisa(120_000, 0)).toBe(0);
  });

  it('refuses a fractional or out-of-range percent and bad paisa', () => {
    expect(() => percentOfPaisa(100, 15.5)).toThrow(RangeError);
    expect(() => percentOfPaisa(100, 101)).toThrow(RangeError);
    expect(() => percentOfPaisa(100, -1)).toThrow(RangeError);
    expect(() => percentOfPaisa(-1, 10)).toThrow(RangeError);
    expect(() => percentOfPaisa(10.5, 10)).toThrow(RangeError);
    // paisa × percent past MAX_SAFE_INTEGER would lose exactness: refused.
    expect(() => percentOfPaisa(Number.MAX_SAFE_INTEGER, 2)).toThrow(RangeError);
  });
});

describe('promo rules', () => {
  const pct = { type: 'percentage' as const, value: 15 };
  const fixed = { type: 'fixed' as const, value: 20_000 };

  it('normalises what buyers type', () => {
    expect(normalisePromoCode(' dhaka 15 ')).toBe('DHAKA15');
    expect(normalisePromoCode('Friends-200')).toBe('FRIENDS-200');
  });

  it('an unrestricted code covers every ticket type; a restricted one only its own', () => {
    expect(promoAppliesTo({ ticketTypeIds: [] }, 'tt-any')).toBe(true);
    expect(promoAppliesTo({ ticketTypeIds: ['tt-1'] }, 'tt-1')).toBe(true);
    expect(promoAppliesTo({ ticketTypeIds: ['tt-1'] }, 'tt-2')).toBe(false);
  });

  it('discounts per ticket: percentage floors per ticket, fixed never below ৳0', () => {
    expect(promoDiscountPerTicket(pct, 120_000)).toBe(18_000);
    expect(promoDiscountPaisa(pct, 120_000, 2)).toBe(36_000);
    // Per ticket then × quantity: 3 × floor(799.50 × 15%) = 3 × 119.92, not floor(3 × 119.925).
    expect(promoDiscountPaisa(pct, 79_950, 3)).toBe(3 * 11_992);
    expect(promoDiscountPerTicket(fixed, 120_000)).toBe(20_000);
    expect(promoDiscountPaisa(fixed, 120_000, 3)).toBe(60_000);
    // ৳200 off a ৳50 ticket takes ৳50, not ৳200: no ticket goes below zero.
    expect(promoDiscountPerTicket(fixed, 5_000)).toBe(5_000);
    expect(promoDiscountPaisa({ type: 'percentage', value: 100 }, 120_000, 2)).toBe(240_000);
  });

  it('feeds computeOrderTotals without ever producing a negative total', () => {
    // The arithmetic floor. judgePromo (below) refuses this case before
    // pricing — a ৳0 order cannot be paid by bKash.
    const totals = computeOrderTotals({
      unitPricePaisa: 5_000,
      quantity: 2,
      discountPaisa: promoDiscountPaisa(fixed, 5_000, 2),
    });
    expect(totals).toMatchObject({ subtotalPaisa: 10_000, discountPaisa: 10_000, totalPaisa: 0 });
  });

  it('judgePromo: one answer for Apply and submit; never a free ticket', () => {
    const types = [
      { id: 'tt-1', pricePaisa: 120_000 },
      { id: 'tt-2', pricePaisa: 15_000 },
    ];
    const rule = {
      code: 'X',
      type: 'fixed' as const,
      value: 20_000,
      active: true,
      ticketTypeIds: [],
    };
    expect(judgePromo(rule, types, 'tt-1')).toBeNull();
    // Switched off and unknown read the same — probing cannot tell them apart.
    expect(judgePromo({ ...rule, active: false }, types, 'tt-1')).toBe('unknown');
    expect(judgePromo(null, types, 'tt-1')).toBe('unknown');
    // Restricted to another event's types: "not valid for this event", not "wrong type".
    expect(judgePromo({ ...rule, ticketTypeIds: ['elsewhere'] }, types, 'tt-1')).toBe('unknown');
    expect(judgePromo({ ...rule, ticketTypeIds: ['tt-2'] }, types, 'tt-1')).toBe(
      'not_for_ticket_type',
    );
    // ৳200 off a ৳150 ticket would make it free: refused for that type only.
    expect(judgePromo(rule, types, 'tt-2')).toBe('makes_ticket_free');
    const hundred = { ...rule, type: 'percentage' as const, value: 100 };
    expect(judgePromo(hundred, types, 'tt-1')).toBe('makes_ticket_free');
  });

  it('describes itself in the buyer-facing words', () => {
    expect(describePromo(pct)).toBe('15% off');
    expect(describePromo(fixed)).toBe('৳200.00 off each ticket');
  });
});

describe('promoCodeFormSchema', () => {
  const tt = '5f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
  const base = {
    code: 'dhaka15',
    type: 'percentage',
    value: '15',
    scope: 'all',
    ticketTypeIds: [],
    active: true,
  };

  it('stores the code in capitals and a percentage as a whole number', () => {
    expect(promoCodeFormSchema.parse(base)).toEqual({
      code: 'DHAKA15',
      type: 'percentage',
      value: 15,
      ticketTypeIds: [],
      active: true,
    });
  });

  it('the scope is explicit: "only these" needs a tick, "any" ignores ticks', () => {
    const some = promoCodeFormSchema.parse({ ...base, scope: 'some', ticketTypeIds: [tt] });
    expect(some.ticketTypeIds).toEqual([tt]);
    const all = promoCodeFormSchema.parse({ ...base, scope: 'all', ticketTypeIds: [tt] });
    expect(all.ticketTypeIds).toEqual([]);
    const none = promoCodeFormSchema.safeParse({ ...base, scope: 'some', ticketTypeIds: [] });
    expect(none.success).toBe(false);
    expect(none.error!.issues[0]!.path[0]).toBe('ticketTypeIds');
  });

  it('converts a fixed amount in taka to paisa', () => {
    expect(promoCodeFormSchema.parse({ ...base, type: 'fixed', value: '199.50' }).value).toBe(
      19_950,
    );
    expect(promoCodeFormSchema.parse({ ...base, type: 'fixed', value: '200' }).value).toBe(20_000);
  });

  it.each([
    [{ code: 'ab' }, 'code', 'at least 3'],
    [{ code: 'DHAKA 15!' }, 'code', 'letters, numbers and hyphens'],
    [{ code: '-DHAKA' }, 'code', 'letters, numbers and hyphens'],
    [{ code: 'A'.repeat(25) }, 'code', '24 characters'],
    [{ value: '0' }, 'value', '1 – 99'],
    [{ value: '100' }, 'value', '1 – 99'],
    [{ value: '12.5' }, 'value', '1 – 99'],
    [{ type: 'fixed', value: '0' }, 'value', 'above ৳0'],
    [{ type: 'fixed', value: '10.555' }, 'value', 'above ৳0'],
    [{ type: 'bogus' }, 'type', 'Percentage or Fixed'],
    [{ scope: 'bogus' }, 'scope', 'Any ticket type or Only these'],
    [{ scope: 'some', ticketTypeIds: ['not-a-uuid'] }, 'ticketTypeIds', 'from the list'],
  ])('refuses %j', (patch, field, message) => {
    const r = promoCodeFormSchema.safeParse({ ...base, ...patch });
    expect(r.success).toBe(false);
    const issue = r.error!.issues[0]!;
    expect(issue.path[0]).toBe(field);
    expect(issue.message).toContain(message);
  });
});

describe('registration + Apply schemas', () => {
  const reg = {
    ticketTypeId: '5f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d',
    quantity: '1',
    buyerName: 'Nusrat Jahan',
    buyerEmail: 'n@example.com',
    buyerPhone: '1712345678',
    terms: 'on',
  };

  it('the registration form carries the code as typed, normalised; blank means none', () => {
    expect(registrationFormSchema.parse({ ...reg, promoCode: ' dhaka15 ' }).promoCode).toBe(
      'DHAKA15',
    );
    expect(registrationFormSchema.parse({ ...reg, promoCode: '' }).promoCode).toBeUndefined();
    expect(registrationFormSchema.parse(reg).promoCode).toBeUndefined();
  });

  it('Apply needs an event, a well-formed code and a ticket type', () => {
    const ok = { eventSlug: 'live-dhaka', code: 'dhaka15', ticketTypeId: reg.ticketTypeId };
    expect(promoCheckSchema.parse(ok).code).toBe('DHAKA15');
    expect(promoCheckSchema.safeParse({ ...ok, code: 'x' }).success).toBe(false);
    expect(promoCheckSchema.safeParse({ ...ok, ticketTypeId: 'nope' }).success).toBe(false);
    expect(promoCheckSchema.safeParse({ ...ok, eventSlug: '' }).success).toBe(false);
  });
});
