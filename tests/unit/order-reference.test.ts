import { describe, expect, it } from 'vitest';
import {
  ORDER_REFERENCE_ALPHABET,
  ORDER_REFERENCE_PATTERN,
  generateOrderReference,
} from '@/server/lib/order-reference';

describe('generateOrderReference', () => {
  it('is EA- plus six characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const ref = generateOrderReference();
      expect(ref).toMatch(ORDER_REFERENCE_PATTERN);
    }
    for (const c of '0O1IL') expect(ORDER_REFERENCE_ALPHABET).not.toContain(c);
  });

  it('is deterministic under an injected RNG', () => {
    expect(generateOrderReference(() => 0)).toBe('EA-AAAAAA');
    expect(generateOrderReference((n) => n - 1)).toBe('EA-999999');
  });
});
