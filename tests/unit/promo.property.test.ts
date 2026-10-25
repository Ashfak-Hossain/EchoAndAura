import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toBanglaDigits } from '@/server/lib/digits';
import { computeOrderTotals } from '@/server/lib/pricing';
import {
  PROMO_CODE_MAX,
  PROMO_CODE_PATTERN,
  type PromoRule,
  judgePromo,
  normalisePromoCode,
  promoAppliesTo,
  promoDiscountPaisa,
  promoDiscountPerTicket,
} from '@/server/lib/promo';

/**
 * Property tests for Invariant 5 and B10 (ADR-027): whatever the code and
 * whatever the price, the server's total is never negative, never a credit,
 * and an accepted code never leaves a ৳0 order bKash cannot pay.
 */

/** Up to the form's 9 taka digits (ticket-types validation). */
const price = fc.integer({ min: 0, max: 99_999_999_999 });
const quantity = fc.integer({ min: 1, max: 10 });

/** Wider than the form allows (1–99%, fixed > 0) so the edges are covered too. */
const discount = fc.oneof(
  fc.record({ type: fc.constant('percentage' as const), value: fc.integer({ min: 0, max: 100 }) }),
  fc.record({
    type: fc.constant('fixed' as const),
    value: fc.integer({ min: 0, max: 200_000_000_000 }),
  }),
);

/**
 * An event's ticket types, a rule restricted to some of them (or to none,
 * which means all) plus ids from other events, and the type being bought.
 */
const promoCase = fc
  .uniqueArray(fc.record({ id: fc.uuid(), pricePaisa: price }), {
    minLength: 1,
    maxLength: 5,
    selector: (t) => t.id,
  })
  .chain((types) =>
    fc.record({
      types: fc.constant(types),
      rule: fc.record({
        code: fc.constant('TEST10'),
        active: fc.boolean(),
        ticketTypeIds: fc
          .tuple(fc.subarray(types.map((t) => t.id)), fc.array(fc.uuid(), { maxLength: 2 }))
          .map(([own, foreign]) => [...own, ...foreign]),
      }),
      discount,
      chosen: fc.constantFrom(...types),
    }),
  )
  .map(({ types, rule, discount: d, chosen }) => ({
    types,
    rule: { ...rule, ...d } satisfies PromoRule,
    chosen,
  }));

describe('promo and pricing properties', () => {
  it('a total is never negative and the discount never exceeds the subtotal', () => {
    // A fixed code larger than the order is capped, so no order is a credit.
    // Half the discounts fit inside the order, half may exceed it, so both
    // the partial and the capped branch are drawn often.
    const order = fc
      .tuple(price, quantity)
      .chain(([unit, qty]) =>
        fc.tuple(
          fc.constant(unit),
          fc.constant(qty),
          fc.oneof(fc.integer({ min: 0, max: unit * qty }), fc.integer({ min: 0, max: 2 ** 50 })),
        ),
      );
    fc.assert(
      fc.property(order, ([unit, qty, off]) => {
        const t = computeOrderTotals({ unitPricePaisa: unit, quantity: qty, discountPaisa: off });
        expect(t.subtotalPaisa).toBe(unit * qty);
        if (off <= t.subtotalPaisa) expect(t.discountPaisa).toBe(off);
        else expect(t.discountPaisa).toBe(t.subtotalPaisa);
        expect(t.totalPaisa).toBe(t.subtotalPaisa - t.discountPaisa);
        expect(t.totalPaisa).toBeGreaterThanOrEqual(0);
        expect(t.totalPaisa).toBeLessThanOrEqual(t.subtotalPaisa);
      }),
    );
  });

  it('a discount is per ticket: never more than the price, times the quantity', () => {
    fc.assert(
      fc.property(discount, price, quantity, (rule, unit, qty) => {
        const each = promoDiscountPerTicket(rule, unit);
        expect(each).toBeGreaterThanOrEqual(0);
        expect(each).toBeLessThanOrEqual(unit);
        expect(promoDiscountPaisa(rule, unit, qty)).toBe(each * qty);
      }),
    );
  });

  it('an accepted code leaves every ticket costing at least one paisa', () => {
    // The whole point of 'makes_ticket_free' (ADR-027): a ৳0 order cannot
    // be paid by bKash and would sit held until it expired.
    fc.assert(
      fc.property(promoCase, quantity, ({ types, rule, chosen }, qty) => {
        fc.pre(judgePromo(rule, types, chosen.id) === null);
        const totals = computeOrderTotals({
          unitPricePaisa: chosen.pricePaisa,
          quantity: qty,
          discountPaisa: promoDiscountPaisa(rule, chosen.pricePaisa, qty),
        });
        expect(
          chosen.pricePaisa - promoDiscountPerTicket(rule, chosen.pricePaisa),
        ).toBeGreaterThanOrEqual(1);
        expect(totals.totalPaisa).toBeGreaterThanOrEqual(qty);
      }),
    );
  });

  it('a switched-off code answers exactly like one that does not exist', () => {
    // Same answer, so probing cannot tell a real code from a guess.
    fc.assert(
      fc.property(promoCase, ({ types, rule, chosen }) => {
        expect(judgePromo({ ...rule, active: false }, types, chosen.id)).toBe('unknown');
        expect(judgePromo(null, types, chosen.id)).toBe('unknown');
      }),
    );
  });

  it('each refusal means what it says', () => {
    fc.assert(
      fc.property(promoCase, ({ types, rule, chosen }) => {
        const verdict = judgePromo(rule, types, chosen.id);
        const coversEvent = types.some((t) => promoAppliesTo(rule, t.id));
        const coversChosen = promoAppliesTo(rule, chosen.id);
        const free = promoDiscountPerTicket(rule, chosen.pricePaisa) >= chosen.pricePaisa;
        // judgePromo asks in order: is it a code here at all, is it for
        // this ticket type, would it make the ticket free. Each answer is
        // checked both ways, so neither a refusal nor an acceptance can drift.
        // A code for other events only must not reveal that it exists.
        if (rule.active && !coversEvent) expect(verdict).toBe('unknown');
        if (rule.active && coversEvent && !coversChosen)
          expect(verdict).toBe('not_for_ticket_type');
        if (verdict === 'not_for_ticket_type') expect(coversEvent && !coversChosen).toBe(true);
        if (rule.active && coversChosen && free) expect(verdict).toBe('makes_ticket_free');
        if (verdict === 'makes_ticket_free') expect(coversChosen && free).toBe(true);
        if (verdict === null) expect(rule.active && coversChosen && !free).toBe(true);
      }),
    );
  });

  it('a normalised code has no spaces, lower case or non-ASCII digits', () => {
    // What is stored and compared must be one spelling per code. Typing-like
    // characters are mixed in: random Unicode almost never draws a tab or ৫.
    const typed = fc.oneof(
      fc.string({ unit: 'binary', maxLength: 40 }),
      fc.string({ unit: fc.constantFrom(...'aZ9- \t\n০৫৯٣۵'), maxLength: 40 }),
    );
    fc.assert(
      fc.property(typed, (raw) => {
        const once = normalisePromoCode(raw);
        expect(once).not.toMatch(/\s|[a-z]|[০-৯٠-٩۰-۹]/);
        expect(normalisePromoCode(once)).toBe(once);
      }),
    );
  });

  it('a valid code typed in any case, spacing or digit set is the same code', () => {
    // ADR-060: a buyer may type `dhaka ১৫` on a Bangla keyboard.
    const typing = fc.array(
      fc.record({
        lower: fc.boolean(),
        bangla: fc.boolean(),
        before: fc.constantFrom('', ' ', '  ', '\t'),
      }),
      { minLength: PROMO_CODE_MAX, maxLength: PROMO_CODE_MAX },
    );
    fc.assert(
      fc.property(fc.stringMatching(PROMO_CODE_PATTERN), typing, (code, how) => {
        expect(normalisePromoCode(code)).toBe(code);
        const typed = [...code]
          .map((ch, i) => {
            const k = how[i]!;
            const shown = k.bangla ? toBanglaDigits(ch) : ch;
            return k.before + (k.lower ? shown.toLowerCase() : shown);
          })
          .join('');
        expect(normalisePromoCode(typed)).toBe(code);
      }),
    );
  });
});
