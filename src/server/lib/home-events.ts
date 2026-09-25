import type { EventStatus } from '@/server/lib/event-status';

/** The slice of an event the home page needs to choose what to show. */
export interface HomeEventInput {
  status: EventStatus;
  startsAt: Date;
  registrationClosesAt: Date | null;
}

export interface HomeSelection<T> {
  /**
   * The main event: the soonest upcoming published event still taking
   * registrations (see `selectHomeEvents`), or null → the "no live event" state.
   */
  featured: T | null;
  /** The other upcoming published events, soonest first, capped. */
  alsoUpcoming: T[];
  /** Every upcoming published event, the featured one included: "All upcoming events (n) →". */
  upcomingTotal: number;
  /** Most recent events that have started, newest first. */
  past: T[];
}

/**
 * Phones show all six in a sideways strip; desktop shows the first four in
 * one row. One read serves both widths, so the cap is the larger of the two.
 */
export const PAST_EVENTS_LIMIT = 6;
/** "Also upcoming" is a strip, not a directory; /events lists the rest. */
export const UPCOMING_EVENTS_LIMIT = 6;

/**
 * /events: every published event that has not started, soonest first, no
 * cap. Drafts are never shown, and an archived future event was pulled on
 * purpose, so it is not upcoming either. An event starting this minute is
 * still upcoming (the page must not drop it while doors are opening).
 */
export function selectUpcomingEvents<T extends HomeEventInput>(
  events: readonly T[],
  now: Date,
): T[] {
  return events
    .filter((e) => e.status === 'published' && e.startsAt.getTime() >= now.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Same boundary as `eventPhase`: registration is closed from `registrationClosesAt` on. */
function registrationClosed(event: HomeEventInput, now: Date): boolean {
  return (
    event.registrationClosesAt !== null && event.registrationClosesAt.getTime() <= now.getTime()
  );
}

/**
 * A1 home: which events go where. Pure so the boundary cases (event starting
 * this minute, drafts, archived-but-future) are unit-tested without a DB.
 *
 * - The main event is the soonest *published* event that has not started and
 *   whose registration has not closed. Registration closes days before the
 *   show (usually 5), so the plain "soonest" rule would fill the hero with
 *   a show nobody can buy for its last days, and the header would lose "Get
 *   tickets", while a later show is on sale below it (Canvas 6, decision 6).
 *   The closed show moves into "Also upcoming" with its "Registration
 *   closed" chip. When every upcoming show has closed, the soonest one is
 *   still the hero: a closed show beats the dormant state.
 * - Drafts are never shown. Archived events only appear in the past strip:
 *   an archived future event was pulled on purpose.
 * - Past = started before `now`, published or archived (archived is how a
 *   finished event is normally filed), newest first, capped.
 */
export function selectHomeEvents<T extends HomeEventInput>(
  events: readonly T[],
  now: Date,
): HomeSelection<T> {
  const upcoming = selectUpcomingEvents(events, now);
  const featured = upcoming.find((e) => !registrationClosed(e, now)) ?? upcoming[0] ?? null;

  const past = events
    .filter((e) => e.status !== 'draft' && e.startsAt.getTime() < now.getTime())
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
    .slice(0, PAST_EVENTS_LIMIT);

  return {
    featured,
    alsoUpcoming: upcoming.filter((e) => e !== featured).slice(0, UPCOMING_EVENTS_LIMIT),
    upcomingTotal: upcoming.length,
    past,
  };
}

/**
 * A6 archive: every event that has started, newest first, no cap. Same
 * membership rule as the home page's past strip (published or archived,
 * never draft; an archived *future* event was pulled on purpose and is
 * not "past"), so the strip's "See all" never shows fewer than the strip.
 */
export function selectArchiveEvents<T extends Pick<HomeEventInput, 'status' | 'startsAt'>>(
  events: readonly T[],
  now: Date,
): T[] {
  return events
    .filter((e) => e.status !== 'draft' && e.startsAt.getTime() < now.getTime())
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
}
