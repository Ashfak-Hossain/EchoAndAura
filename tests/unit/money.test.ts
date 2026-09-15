import { describe, expect, it } from 'vitest';
import {
  assertValidPaisa,
  formatBDT,
  multiplyPaisa,
  paisaToTaka,
  PAISA_PER_TAKA,
  sumPaisa,
  takaToPaisa,
} from '@/server/lib/money';

describe('takaToPaisa', () => {
  it('converts whole and fractional taka to integer paisa', () => {
    expect(takaToPaisa(0)).toBe(0);
    expect(takaToPaisa(1)).toBe(100);
    expect(takaToPaisa(12.34)).toBe(1234);
  });

  it('rounds away float representation error (19.99 → 1999, not 1998)', () => {
    // 19.99 * 100 === 1998.9999999999998 in IEEE-754.
    expect(takaToPaisa(19.99)).toBe(1999);
  });

  // Failure paths — money code must reject bad input, not coerce it.
  it('throws on NaN', () => {
    expect(() => takaToPaisa(Number.NaN)).toThrow(RangeError);
  });

  it('throws on Infinity', () => {
    expect(() => takaToPaisa(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('throws on negative amounts', () => {
    expect(() => takaToPaisa(-1)).toThrow(RangeError);
  });
});

describe('paisaToTaka', () => {
  it('converts integer paisa back to taka', () => {
    expect(paisaToTaka(1234)).toBe(12.34);
    expect(paisaToTaka(0)).toBe(0);
  });

  it('throws on non-integer paisa', () => {
    expect(() => paisaToTaka(1.5)).toThrow(RangeError);
  });

  it('throws on negative paisa', () => {
    expect(() => paisaToTaka(-100)).toThrow(RangeError);
  });
});

describe('assertValidPaisa', () => {
  it('accepts non-negative safe integers', () => {
    expect(() => assertValidPaisa(0)).not.toThrow();
    expect(() => assertValidPaisa(999_999)).not.toThrow();
  });

  it('throws on non-integer, negative, and unsafe values', () => {
    expect(() => assertValidPaisa(1.5)).toThrow(RangeError);
    expect(() => assertValidPaisa(-1)).toThrow(RangeError);
    expect(() => assertValidPaisa(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe('multiplyPaisa', () => {
  it('multiplies a unit price by an integer quantity', () => {
    expect(multiplyPaisa(1200, 3)).toBe(3600);
    expect(multiplyPaisa(1200, 0)).toBe(0);
  });

  it('throws on non-integer or negative quantity', () => {
    expect(() => multiplyPaisa(1200, 1.5)).toThrow(RangeError);
    expect(() => multiplyPaisa(1200, -1)).toThrow(RangeError);
  });

  it('throws when the result would exceed MAX_SAFE_INTEGER', () => {
    expect(() => multiplyPaisa(Number.MAX_SAFE_INTEGER, 2)).toThrow(RangeError);
  });
});

describe('sumPaisa', () => {
  it('sums valid paisa amounts', () => {
    expect(sumPaisa(100, 250, 50)).toBe(400);
    expect(sumPaisa()).toBe(0);
  });

  it('throws if any addend is invalid', () => {
    expect(() => sumPaisa(100, -1)).toThrow(RangeError);
    expect(() => sumPaisa(100, 1.5)).toThrow(RangeError);
  });
});

describe('formatBDT', () => {
  it('formats paisa as a grouped Taka string with two decimals', () => {
    expect(formatBDT(0)).toBe('৳0.00');
    expect(formatBDT(5)).toBe('৳0.05');
    expect(formatBDT(100)).toBe('৳1.00');
    expect(formatBDT(123456)).toBe('৳1,234.56');
    expect(formatBDT(100000000)).toBe('৳1,000,000.00');
  });

  it('throws on invalid paisa', () => {
    expect(() => formatBDT(1.5)).toThrow(RangeError);
    expect(() => formatBDT(-1)).toThrow(RangeError);
  });
});

describe('PAISA_PER_TAKA', () => {
  it('is 100', () => {
    expect(PAISA_PER_TAKA).toBe(100);
  });
});
