import type { EventStatus } from '@/server/lib/event-status';

/** The slice of an event the home page needs to choose what to show. */
export interface HomeEventInput {
  status: EventStatus;
  startsAt: Date;
}

export interface HomeSelection<T> {
  /** Soonest upcoming published event, or null → the "no live event" state. */
  featured: T | null;
  /** The next upcoming published events after the hero, soonest first, capped. */
  alsoUpcoming: T[];
  /** Most recent events that have started, newest first. */
  past: T[];
}

export const PAST_EVENTS_LIMIT = 4;
/** "Also upcoming" is a strip, not a directory; the archive lists the rest. */
export const UPCOMING_EVENTS_LIMIT = 6;

/**
 * A1 home: which events go where. Pure so the boundary cases (event starting
 * this minute, drafts, archived-but-future) are unit-tested without a DB.
 *
 * - Hero is always the soonest *published* event that has not started.
 * - Drafts are never shown. Archived events only appear in the past strip:
 *   an archived future event was pulled on purpose.
 * - Past = started before `now`, published or archived (archived is how a
 *   finished event is normally filed), newest first, capped.
 */
export function selectHomeEvents<T extends HomeEventInput>(
  events: readonly T[],
  now: Date,
): HomeSelection<T> {
  const upcoming = events
    .filter((e) => e.status === 'published' && e.startsAt.getTime() >= now.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const past = events
    .filter((e) => e.status !== 'draft' && e.startsAt.getTime() < now.getTime())
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
    .slice(0, PAST_EVENTS_LIMIT);

  return {
    featured: upcoming[0] ?? null,
    alsoUpcoming: upcoming.slice(1, 1 + UPCOMING_EVENTS_LIMIT),
    past,
  };
}

/**
 * A6 archive: every event that has started, newest first, no cap. Same
 * membership rule as the home page's past strip (published or archived,
 * never draft; an archived *future* event was pulled on purpose and is
 * not "past"), so the strip's "See all" never shows fewer than the strip.
 */
export function selectArchiveEvents<T extends HomeEventInput>(
  events: readonly T[],
  now: Date,
): T[] {
  return events
    .filter((e) => e.status !== 'draft' && e.startsAt.getTime() < now.getTime())
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
}
