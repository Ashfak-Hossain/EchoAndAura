import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { orderStatus } from '@/db/schema';
import { InvalidOrderTransitionError } from '@/server/lib/errors';
import {
  ORDER_TRANSITIONS,
  REVENUE_STATUSES,
  type OrderStatus,
  assertOrderTransition,
  holdsInventory,
} from '@/server/lib/order-status';

/**
 * order-status.test.ts checks every single move against CLAUDE.md. These
 * check whole lives of an order: random sequences of attempted moves from
 * `pending_payment`, legal and illegal mixed, and what must hold along any
 * path the table allows.
 */

const ALL = orderStatus.enumValues;
const TERMINAL = ALL.filter((s) => ORDER_TRANSITIONS[s].length === 0);

/** Either "take the n-th legal exit" (so walks get deep) or "try this status". */
const attempt = fc.oneof(
  fc.record({ legal: fc.nat() }),
  fc.record({ target: fc.constantFrom(...ALL) }),
);

/** Apply attempts as a service would: assert first, move only if allowed. */
function walk(attempts: readonly ({ legal: number } | { target: OrderStatus })[]): OrderStatus[] {
  const path: OrderStatus[] = ['pending_payment'];
  for (const a of attempts) {
    const from = path.at(-1)!;
    const exits = ORDER_TRANSITIONS[from];
    // Any natural number picks one of the legal exits; max(…, 1) keeps the
    // modulo defined at a terminal status, where the pick is undefined.
    const to = 'legal' in a ? exits[a.legal % Math.max(exits.length, 1)] : a.target;
    if (to === undefined) continue; // a terminal status has no legal exit to take
    try {
      assertOrderTransition(from, to);
      path.push(to);
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidOrderTransitionError);
      expect(error).toMatchObject({ from, to });
      expect(exits).not.toContain(to);
    }
  }
  return path;
}

const lives = fc.array(attempt, { maxLength: 20 }).map(walk);

// About one walk in eight gets past `paid`; 1,000 runs give each property
// over a hundred of those deep paths, in milliseconds.
const DEEP = { numRuns: 1_000 };

describe('order state machine properties', () => {
  it('no order ever returns to a status it has left', () => {
    // Terminal means terminal: a rejected or expired order is never revived
    // (the buyer registers again), and nothing loops back to pending.
    fc.assert(
      fc.property(lives, (path) => {
        expect(new Set(path).size).toBe(path.length);
      }),
      DEEP,
    );
  });

  it('tickets are issued only after a person approved the payment', () => {
    // issued ⇐ paid ⇐ pending_verification: no path skips the admin's check.
    fc.assert(
      fc.property(lives, (path) => {
        const issued = path.indexOf('issued');
        if (issued !== -1) {
          expect(path.slice(0, issued + 1)).toEqual([
            'pending_payment',
            'pending_verification',
            'paid',
            'issued',
          ]);
        }
      }),
      DEEP,
    );
  });

  it('money counts as revenue only once approved, and stops when cancelled', () => {
    fc.assert(
      fc.property(lives, (path) => {
        const earning = path.map((s) => REVENUE_STATUSES.includes(s));
        const first = earning.indexOf(true);
        if (first !== -1) {
          expect(path[first - 1]).toBe('pending_verification');
          expect(path[first]).toBe('paid');
          // One unbroken stretch: once it stops, it never starts again.
          expect(earning.slice(first, earning.lastIndexOf(true) + 1)).not.toContain(false);
        }
      }),
      DEEP,
    );
  });

  it('released inventory is never held again by the same order', () => {
    // Re-holding would take stock the expiry job or a reject already gave
    // back to other buyers (Invariant 2's counters would double-count).
    fc.assert(
      fc.property(lives, (path) => {
        const holding = path.map(holdsInventory);
        const released = holding.indexOf(false);
        if (released !== -1) expect(holding.slice(released)).not.toContain(true);
      }),
      DEEP,
    );
  });

  it('an order holds stock only while it waits on the buyer or the admin', () => {
    // Held seats are not yet sold (ADR-054): once paid they are sold, and a
    // finished order must not keep seats from other buyers. The expected
    // set is written out, not read from the table under test.
    const WAITING: readonly OrderStatus[] = ['pending_payment', 'pending_verification'];
    fc.assert(
      fc.property(lives, (path) => {
        for (const s of path) expect(holdsInventory(s), s).toBe(WAITING.includes(s));
      }),
      DEEP,
    );
  });

  it('a terminal status refuses every move', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TERMINAL), fc.constantFrom(...ALL), (from, to) => {
        expect(() => assertOrderTransition(from, to)).toThrow(InvalidOrderTransitionError);
      }),
    );
  });
});
