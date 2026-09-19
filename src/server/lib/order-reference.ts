import { randomInt } from 'node:crypto';

/**
 * Human-facing order reference, e.g. `EA-7K3M9Q`. The buyer types it into
 * the bKash "reference" field and reads it back over the phone, so the
 * alphabet drops the characters people confuse (0/O, 1/I/L). Six characters
 * of a 31-symbol alphabet is ~887 M values: collisions are rare, and the
 * UNIQUE constraint on orders.reference plus a retry in the service handle
 * the rest. It is NOT a secret — the order page URL uses the uuid.
 */
export const ORDER_REFERENCE_PREFIX = 'EA-';
export const ORDER_REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ORDER_REFERENCE_LENGTH = 6;
export const ORDER_REFERENCE_PATTERN = /^EA-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

/** `random(n)` returns an integer in [0, n); defaults to crypto. Injectable for tests. */
export function generateOrderReference(random: (max: number) => number = randomInt): string {
  let body = '';
  for (let i = 0; i < ORDER_REFERENCE_LENGTH; i++) {
    body += ORDER_REFERENCE_ALPHABET[random(ORDER_REFERENCE_ALPHABET.length)];
  }
  return ORDER_REFERENCE_PREFIX + body;
}
