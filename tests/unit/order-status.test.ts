import { describe, expect, it } from 'vitest';
import { orderStatus } from '@/db/schema';
import { InvalidOrderTransitionError } from '@/server/lib/errors';
import {
  ORDER_TRANSITIONS,
  type OrderStatus,
  assertOrderTransition,
  holdsInventory,
  isOrderTransitionAllowed,
} from '@/server/lib/order-status';

const ALL = orderStatus.enumValues;

// The legal moves, verbatim from CLAUDE.md § Order state machine.
const LEGAL: [OrderStatus, OrderStatus][] = [
  ['pending_payment', 'pending_verification'],
  ['pending_payment', 'expired'],
  ['pending_verification', 'paid'],
  ['pending_verification', 'rejected'],
  ['pending_verification', 'expired'],
  ['paid', 'issued'],
  ['issued', 'cancelled'],
];

describe('order state machine', () => {
  it('has an entry for every enum value (a new status cannot ship without moves)', () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ALL].sort());
  });

  it('allows exactly the moves in CLAUDE.md and nothing else', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const legal = LEGAL.some(([f, t]) => f === from && t === to);
        expect(isOrderTransitionAllowed(from, to), `${from} → ${to}`).toBe(legal);
        if (legal) {
          expect(() => assertOrderTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertOrderTransition(from, to)).toThrow(InvalidOrderTransitionError);
        }
      }
    }
  });

  it('terminal states have no exits', () => {
    for (const s of ['rejected', 'expired', 'cancelled'] as const) {
      expect(ORDER_TRANSITIONS[s]).toEqual([]);
    }
  });

  it('knows which statuses still hold inventory', () => {
    expect(ALL.filter(holdsInventory)).toEqual(['pending_payment', 'pending_verification']);
  });
});
