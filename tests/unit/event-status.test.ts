import { describe, expect, it } from 'vitest';
import { InvalidEventTransitionError } from '@/server/lib/errors';
import {
  EVENT_TRANSITIONS,
  type EventStatus,
  allowedEventTransitions,
  assertEventTransition,
  isEventTransitionAllowed,
} from '@/server/lib/event-status';

const ALL: EventStatus[] = ['draft', 'published', 'archived'];

describe('event status state machine', () => {
  it('allows exactly the documented moves', () => {
    expect(EVENT_TRANSITIONS).toEqual({
      draft: ['published', 'archived'],
      published: ['draft', 'archived'],
      archived: ['draft'],
    });
  });

  it('accepts every allowed pair', () => {
    for (const from of ALL) {
      for (const to of allowedEventTransitions(from)) {
        expect(() => assertEventTransition(from, to)).not.toThrow();
        expect(isEventTransitionAllowed(from, to)).toBe(true);
      }
    }
  });

  // Failure path: every pair not in the table throws, naming both ends.
  it('rejects every other pair, including a no-op to the same status', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        if (EVENT_TRANSITIONS[from].includes(to)) continue;
        expect(isEventTransitionAllowed(from, to)).toBe(false);
        expect(() => assertEventTransition(from, to)).toThrow(InvalidEventTransitionError);
        expect(() => assertEventTransition(from, to)).toThrow(`"${from}" to "${to}"`);
      }
    }
    expect(() => assertEventTransition('archived', 'published')).toThrow(
      InvalidEventTransitionError,
    );
  });
});
