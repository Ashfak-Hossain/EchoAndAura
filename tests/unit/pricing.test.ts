import { describe, expect, it } from 'vitest';
import { computeOrderTotals } from '@/server/lib/pricing';

describe('computeOrderTotals', () => {
  it('multiplies exactly in paisa and defaults the discount to zero', () => {
    expect(computeOrderTotals({ unitPricePaisa: 120_000, quantity: 3 })).toEqual({
      unitPricePaisa: 120_000,
      quantity: 3,
      subtotalPaisa: 360_000,
      discountPaisa: 0,
      totalPaisa: 360_000,
    });
  });

  it('applies a discount and caps it at the subtotal — never a negative total', () => {
    expect(
      computeOrderTotals({ unitPricePaisa: 80_000, quantity: 2, discountPaisa: 30_000 }).totalPaisa,
    ).toBe(130_000);
    const capped = computeOrderTotals({
      unitPricePaisa: 80_000,
      quantity: 1,
      discountPaisa: 999_999,
    });
    expect(capped).toMatchObject({ discountPaisa: 80_000, totalPaisa: 0 });
  });

  it('a free ticket type is a valid zero total', () => {
    expect(computeOrderTotals({ unitPricePaisa: 0, quantity: 5 }).totalPaisa).toBe(0);
  });

  // Failure paths: anything that is not integer paisa is refused, not rounded.
  it('rejects fractional or negative money and non-integer quantities', () => {
    expect(() => computeOrderTotals({ unitPricePaisa: 10.5, quantity: 1 })).toThrow(RangeError);
    expect(() => computeOrderTotals({ unitPricePaisa: -1, quantity: 1 })).toThrow(RangeError);
    expect(() => computeOrderTotals({ unitPricePaisa: 100, quantity: 1.5 })).toThrow(RangeError);
    expect(() =>
      computeOrderTotals({ unitPricePaisa: 100, quantity: 1, discountPaisa: -5 }),
    ).toThrow(RangeError);
    expect(() =>
      computeOrderTotals({ unitPricePaisa: Number.MAX_SAFE_INTEGER, quantity: 2 }),
    ).toThrow(RangeError);
  });
});
