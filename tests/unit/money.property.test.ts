import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normaliseDigits } from '@/server/lib/digits';
import {
  assertValidPaisa,
  averagePaisa,
  formatBDT,
  formatDecimalBDT,
  multiplyPaisa,
  paisaToTaka,
  percentOfPaisa,
  sumPaisa,
  takaToPaisa,
} from '@/server/lib/money';

/**
 * Property tests for Invariant 1: the example tests in money.test.ts pick
 * the cases we thought of; these let fast-check pick thousands we did not,
 * and shrink any failure to the smallest amount that breaks a rule.
 */

/** Any amount the database could hold that JS still adds exactly. */
const paisa = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });
/** Up to ৳10 billion: far past any real order, small enough that ×100 stays exact. */
const plausiblePaisa = fc.integer({ min: 0, max: 1_000_000_000_000 });

/** Everything money.ts must refuse rather than coerce. */
const invalidPaisa = fc.oneof(
  fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Number.isInteger(n)),
  fc.integer({ min: Number.MIN_SAFE_INTEGER, max: -1 }),
  // Doubles this large are all integers, so only the safe-range check stops them.
  fc.double({ min: 2 ** 53, max: Number.MAX_VALUE, noNaN: true }),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
);

describe('money properties', () => {
  it('paisa → taka → paisa gives back the same paisa', () => {
    // A total shown as taka and parsed back (CSV, form defaults) must not
    // drift by a paisa. Exact up to 2^51 paisa (৳22.5 trillion); past that a
    // taka double cannot hold every paisa and fast-check finds a one-paisa
    // slip near 2^52. The forms cap a price at 9 taka digits (< 10^11
    // paisa), so ten tickets stay 2,000× below the edge.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 51 }), (p) => {
        expect(takaToPaisa(paisaToTaka(p))).toBe(p);
      }),
    );
  });

  it('sumPaisa is the exact integer sum, in any order', () => {
    fc.assert(
      fc.property(fc.array(plausiblePaisa, { maxLength: 50 }), (amounts) => {
        const exact = amounts.reduce((total, a) => total + BigInt(a), BigInt(0));
        expect(BigInt(sumPaisa(...amounts))).toBe(exact);
        expect(sumPaisa(...amounts.toReversed())).toBe(sumPaisa(...amounts));
      }),
    );
  });

  it('multiplyPaisa equals adding the price once per ticket', () => {
    fc.assert(
      fc.property(plausiblePaisa, fc.integer({ min: 0, max: 10 }), (price, qty) => {
        expect(multiplyPaisa(price, qty)).toBe(sumPaisa(...Array<number>(qty).fill(price)));
      }),
    );
  });

  it('percentOfPaisa is the exact floor: never a paisa more than offered', () => {
    // r·100 ≤ p·pct < (r+1)·100 is the definition of floor(p·pct / 100),
    // checked in BigInt so the oracle cannot share a float error.
    fc.assert(
      fc.property(plausiblePaisa, fc.integer({ min: 0, max: 100 }), (p, pct) => {
        const r = percentOfPaisa(p, pct);
        const scaled = BigInt(p) * BigInt(pct);
        expect(BigInt(r) * BigInt(100) <= scaled).toBe(true);
        expect(scaled < (BigInt(r) + BigInt(1)) * BigInt(100)).toBe(true);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(p);
      }),
    );
  });

  it('percentOfPaisa grows with the percentage, from 0 to the whole amount', () => {
    fc.assert(
      fc.property(
        plausiblePaisa,
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (p, a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(percentOfPaisa(p, lo)).toBeLessThanOrEqual(percentOfPaisa(p, hi));
          expect(percentOfPaisa(p, 0)).toBe(0);
          expect(percentOfPaisa(p, 100)).toBe(p);
        },
      ),
    );
  });

  it('percentOfPaisa refuses an amount whose product would lose precision', () => {
    fc.assert(
      fc.property(paisa, fc.integer({ min: 1, max: 100 }), (p, pct) => {
        // Exact in BigInt, so the boundary is not judged by the same float
        // product the code uses.
        fc.pre(BigInt(p) * BigInt(pct) > BigInt(Number.MAX_SAFE_INTEGER));
        expect(() => percentOfPaisa(p, pct)).toThrow(RangeError);
      }),
    );
  });

  it('formatBDT and formatDecimalBDT read back as the same paisa', () => {
    // What the buyer is told to send and what the CSV sums must be the
    // amount on the order, to the paisa.
    const readBack = (text: string) => {
      const [taka = '', fraction = ''] = text.replace(/[৳,]/g, '').split('.');
      expect(fraction).toMatch(/^\d{2}$/);
      return BigInt(taka) * BigInt(100) + BigInt(fraction);
    };
    fc.assert(
      fc.property(paisa, (p) => {
        const en = formatBDT(p);
        // Thousands, and no leading zeros (BigInt would read `000,123` as 123).
        expect(en).toMatch(/^৳(?:0|[1-9]\d{0,2}(?:,\d{3})*)\.\d{2}$/);
        expect(readBack(en)).toBe(BigInt(p));
        expect(readBack(formatDecimalBDT(p))).toBe(BigInt(p));
      }),
    );
  });

  it('the Bangla amount is the English amount in lakh grouping and Bangla digits', () => {
    fc.assert(
      fc.property(paisa, (p) => {
        const bn = formatBDT(p, 'bn');
        expect(bn).not.toMatch(/[0-9]/);
        const ascii = normaliseDigits(bn);
        // Lakh grouping: the last three digits, then pairs (`১২,৩৪,৫৬৭`).
        expect(ascii).toMatch(/^৳(?:[1-9]\d?(?:,\d{2})*,\d{3}|0|[1-9]\d{0,2})\.\d{2}$/);
        expect(ascii.replaceAll(',', '')).toBe(formatBDT(p).replaceAll(',', ''));
      }),
    );
  });

  it('averagePaisa is within half a paisa per unit of the exact share', () => {
    fc.assert(
      fc.property(plausiblePaisa, fc.integer({ min: 0, max: 1_000_000 }), (p, count) => {
        const avg = averagePaisa(p, count);
        if (count === 0) {
          expect(avg).toBe(0);
          return;
        }
        // |avg·count − p| ≤ count/2, doubled to stay in integers.
        const error = BigInt(avg) * BigInt(count) - BigInt(p);
        const absError = error < BigInt(0) ? -error : error;
        expect(absError * BigInt(2) <= BigInt(count)).toBe(true);
      }),
    );
  });

  // Failure path: bad input must throw, never come back as a plausible number.
  it('every paisa function refuses an invalid amount', () => {
    fc.assert(
      fc.property(invalidPaisa, (bad) => {
        expect(() => assertValidPaisa(bad)).toThrow(RangeError);
        expect(() => paisaToTaka(bad)).toThrow(RangeError);
        expect(() => multiplyPaisa(bad, 1)).toThrow(RangeError);
        expect(() => sumPaisa(0, bad)).toThrow(RangeError);
        expect(() => percentOfPaisa(bad, 10)).toThrow(RangeError);
        expect(() => formatBDT(bad)).toThrow(RangeError);
        expect(() => formatBDT(bad, 'bn')).toThrow(RangeError);
        expect(() => formatDecimalBDT(bad)).toThrow(RangeError);
        expect(() => averagePaisa(bad, 1)).toThrow(RangeError);
      }),
    );
  });

  it('a result past MAX_SAFE_INTEGER is refused, even from valid inputs', () => {
    // Each input is a valid amount; only the sum, product or conversion
    // would lose precision, and that must throw, not round.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER - 1 }), (a) => {
        expect(() => sumPaisa(Number.MAX_SAFE_INTEGER - a, a + 1)).toThrow(RangeError);
        const half = Math.ceil(Number.MAX_SAFE_INTEGER / 2) + (a % 1000);
        expect(() => multiplyPaisa(half, 2)).toThrow(RangeError);
        expect(() => takaToPaisa(Number.MAX_SAFE_INTEGER / 100 + 1 + a)).toThrow(RangeError);
      }),
    );
  });

  it('takaToPaisa refuses negative and non-finite taka', () => {
    const badTaka = fc.oneof(
      fc.double({ max: -Number.MIN_VALUE, noNaN: true }),
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    );
    fc.assert(
      fc.property(badTaka, (taka) => {
        expect(() => takaToPaisa(taka)).toThrow(RangeError);
      }),
    );
  });

  it('a quantity or count that is not a whole number is refused', () => {
    const badCount = fc.oneof(
      fc.integer({ min: Number.MIN_SAFE_INTEGER, max: -1 }),
      fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Number.isInteger(n)),
    );
    fc.assert(
      fc.property(plausiblePaisa, badCount, (p, n) => {
        expect(() => multiplyPaisa(p, n)).toThrow(RangeError);
        expect(() => averagePaisa(p, n)).toThrow(RangeError);
      }),
    );
  });
});
