import { eventStatus } from '@/db/schema';
import { InvalidEventTransitionError } from '@/server/lib/errors';

/**
 * Event status state machine. Like the order state machine in CLAUDE.md,
 * transitions are validated in code and an invalid one throws — the enum in
 * the schema bounds the values, this table bounds the moves.
 *
 *   draft ⇄ published
 *   draft → archived, published → archived
 *   archived → draft   (a mistaken archive must be recoverable)
 *
 * The admin UI renders its buttons from `allowedEventTransitions`, so the
 * page can never offer a move the service would reject.
 */

export type EventStatus = (typeof eventStatus.enumValues)[number];

export const EVENT_TRANSITIONS: Readonly<Record<EventStatus, readonly EventStatus[]>> = {
  draft: ['published', 'archived'],
  published: ['draft', 'archived'],
  archived: ['draft'],
};

export function allowedEventTransitions(from: EventStatus): readonly EventStatus[] {
  return EVENT_TRANSITIONS[from];
}

export function isEventTransitionAllowed(from: EventStatus, to: EventStatus): boolean {
  return EVENT_TRANSITIONS[from].includes(to);
}

/** @throws InvalidEventTransitionError */
export function assertEventTransition(from: EventStatus, to: EventStatus): void {
  if (!isEventTransitionAllowed(from, to)) {
    throw new InvalidEventTransitionError(from, to);
  }
}
