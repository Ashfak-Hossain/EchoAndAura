import { describe, expect, it } from 'vitest';
import type { EventStatus } from '@/server/lib/event-status';
import {
  PAST_EVENTS_LIMIT,
  UPCOMING_EVENTS_LIMIT,
  selectArchiveEvents,
  selectHomeEvents,
  selectUpcomingEvents,
} from '@/server/lib/home-events';

const NOW = new Date('2026-09-18T10:00:00Z');
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000);
/** Registration still open unless a close is given (null = no bound set, never "closed"). */
const ev = (
  id: string,
  status: EventStatus,
  startsAt: Date,
  registrationClosesAt: Date | null = null,
) => ({ id, status, startsAt, registrationClosesAt });

describe('selectHomeEvents', () => {
  it('no live event: featured is null, past still lists finished events', () => {
    const sel = selectHomeEvents(
      [ev('old', 'archived', day(-30)), ev('draft', 'draft', day(5))],
      NOW,
    );
    expect(sel.featured).toBeNull();
    expect(sel.alsoUpcoming).toEqual([]);
    expect(sel.past.map((e) => e.id)).toEqual(['old']);
  });

  it('one live event: it is the hero and nothing is "also upcoming"', () => {
    const sel = selectHomeEvents([ev('a', 'published', day(13))], NOW);
    expect(sel.featured?.id).toBe('a');
    expect(sel.alsoUpcoming).toEqual([]);
  });

  it('several: soonest is the hero, the rest follow in date order regardless of input order', () => {
    const sel = selectHomeEvents(
      [
        ev('dec', 'published', day(90)),
        ev('oct', 'published', day(13)),
        ev('nov', 'published', day(57)),
      ],
      NOW,
    );
    expect(sel.featured?.id).toBe('oct');
    expect(sel.alsoUpcoming.map((e) => e.id)).toEqual(['nov', 'dec']);
  });

  it('never shows drafts, and archived future events are not upcoming', () => {
    const sel = selectHomeEvents(
      [ev('d', 'draft', day(1)), ev('pulled', 'archived', day(2)), ev('live', 'published', day(3))],
      NOW,
    );
    expect(sel.featured?.id).toBe('live');
    expect(sel.alsoUpcoming).toEqual([]);
    expect(sel.past).toEqual([]);
  });

  // Boundary: an event starting exactly now is still "upcoming" (the page
  // must not flip to the dormant state while doors are opening).
  it('treats an event starting at `now` as upcoming, one second earlier as past', () => {
    const atNow = selectHomeEvents([ev('x', 'published', NOW)], NOW);
    expect(atNow.featured?.id).toBe('x');
    const justPast = selectHomeEvents([ev('x', 'published', new Date(NOW.getTime() - 1000))], NOW);
    expect(justPast.featured).toBeNull();
    expect(justPast.past.map((e) => e.id)).toEqual(['x']);
  });

  it('caps "also upcoming" so a busy season never becomes a directory, but counts them all', () => {
    const many = Array.from({ length: UPCOMING_EVENTS_LIMIT + 3 }, (_, i) =>
      ev(`u${i}`, 'published', day(i + 1)),
    );
    const sel = selectHomeEvents(many, NOW);
    expect(sel.featured?.id).toBe('u0');
    expect(sel.alsoUpcoming).toHaveLength(UPCOMING_EVENTS_LIMIT);
    expect(sel.alsoUpcoming[0]?.id).toBe('u1');
    // "All upcoming events (n) →" counts every upcoming show, the hero included.
    expect(sel.upcomingTotal).toBe(UPCOMING_EVENTS_LIMIT + 3);
  });

  it('upcomingTotal counts only published, not-started events', () => {
    const sel = selectHomeEvents(
      [
        ev('a', 'published', day(3)),
        ev('b', 'published', day(9)),
        ev('d', 'draft', day(4)),
        ev('pulled', 'archived', day(5)),
        ev('old', 'published', day(-2)),
      ],
      NOW,
    );
    expect(sel.upcomingTotal).toBe(2);
    expect(selectHomeEvents([ev('old', 'archived', day(-2))], NOW).upcomingTotal).toBe(0);
  });

  // Decision 6: a show whose registration has closed has nothing to sell for
  // its last days; the hero goes to the next show that is still on sale.
  it('skips a show whose registration has closed when a later one is still open', () => {
    const sel = selectHomeEvents(
      [
        ev('closed', 'published', day(3), day(-2)),
        ev('open', 'published', day(20), day(15)),
        ev('later', 'published', day(40), day(35)),
      ],
      NOW,
    );
    expect(sel.featured?.id).toBe('open');
    // The closed show is still listed, in date order, with its chip.
    expect(sel.alsoUpcoming.map((e) => e.id)).toEqual(['closed', 'later']);
    expect(sel.upcomingTotal).toBe(3);
  });

  it('falls back to the soonest show when every upcoming show has closed', () => {
    const sel = selectHomeEvents(
      [ev('b', 'published', day(4), day(-1)), ev('a', 'published', day(2), day(-3))],
      NOW,
    );
    expect(sel.featured?.id).toBe('a');
    expect(sel.alsoUpcoming.map((e) => e.id)).toEqual(['b']);
  });

  // Same boundary as eventPhase: closed from registrationClosesAt on.
  it('treats a close at exactly `now` as closed, one second later as open', () => {
    const closingNow = selectHomeEvents(
      [ev('now', 'published', day(2), NOW), ev('next', 'published', day(9), day(5))],
      NOW,
    );
    expect(closingNow.featured?.id).toBe('next');
    const closingSoon = selectHomeEvents(
      [
        ev('soon', 'published', day(2), new Date(NOW.getTime() + 1000)),
        ev('next', 'published', day(9), day(5)),
      ],
      NOW,
    );
    expect(closingSoon.featured?.id).toBe('soon');
  });

  it('a show with no close set is not treated as closed', () => {
    const sel = selectHomeEvents(
      [ev('unset', 'published', day(2), null), ev('next', 'published', day(9), day(5))],
      NOW,
    );
    expect(sel.featured?.id).toBe('unset');
  });

  it('keeps six past shows: phones scroll through six, desktop shows four', () => {
    expect(PAST_EVENTS_LIMIT).toBe(6);
  });

  it('past strip: newest first, published or archived, capped', () => {
    const many = Array.from({ length: PAST_EVENTS_LIMIT + 2 }, (_, i) =>
      ev(`p${i}`, i % 2 ? 'archived' : 'published', day(-(i + 1) * 10)),
    );
    const sel = selectHomeEvents(many, NOW);
    expect(sel.past).toHaveLength(PAST_EVENTS_LIMIT);
    expect(sel.past.map((e) => e.id)).toEqual(
      Array.from({ length: PAST_EVENTS_LIMIT }, (_, i) => `p${i}`),
    );
  });
});

describe('selectUpcomingEvents (/events)', () => {
  it('lists every published show that has not started, soonest first, no cap', () => {
    const many = Array.from({ length: UPCOMING_EVENTS_LIMIT + 3 }, (_, i) =>
      ev(`u${i}`, 'published', day(UPCOMING_EVENTS_LIMIT + 3 - i)),
    );
    const ids = selectUpcomingEvents(many, NOW).map((e) => e.id);
    expect(ids).toHaveLength(UPCOMING_EVENTS_LIMIT + 3);
    expect(ids[0]).toBe(`u${UPCOMING_EVENTS_LIMIT + 2}`);
    expect(ids.at(-1)).toBe('u0');
  });

  it('never lists drafts, pulled (archived) or started shows; a closed show stays listed', () => {
    const ids = selectUpcomingEvents(
      [
        ev('d', 'draft', day(1)),
        ev('pulled', 'archived', day(2)),
        ev('old', 'published', day(-1)),
        ev('closed', 'published', day(3), day(-2)),
        ev('now', 'published', NOW),
      ],
      NOW,
    ).map((e) => e.id);
    expect(ids).toEqual(['now', 'closed']);
  });

  it('holds the hero and "also upcoming" together, whichever is featured', () => {
    const events = [
      ev('closed', 'published', day(3), day(-2)),
      ev('open', 'published', day(20), day(15)),
      ev('later', 'published', day(40), day(35)),
    ];
    const home = selectHomeEvents(events, NOW);
    const all = selectUpcomingEvents(events, NOW);
    expect(all.map((e) => e.id)).toEqual(['closed', 'open', 'later']);
    expect(new Set([home.featured, ...home.alsoUpcoming])).toEqual(new Set(all));
    expect(home.upcomingTotal).toBe(all.length);
  });
});

describe('selectArchiveEvents (A6)', () => {
  it('lists every started event newest first, no cap; drafts and future events never', () => {
    const events = [
      ev('feb', 'archived', day(-200)),
      ev('aug', 'published', day(-20)),
      ev('may', 'archived', day(-120)),
      ev('draft-old', 'draft', day(-300)),
      ev('pulled-future', 'archived', day(10)),
      ev('live', 'published', day(13)),
      ...Array.from({ length: PAST_EVENTS_LIMIT + 2 }, (_, i) =>
        ev(`x${i}`, 'archived', day(-400 - i)),
      ),
    ];
    const ids = selectArchiveEvents(events, NOW).map((e) => e.id);
    expect(ids.slice(0, 3)).toEqual(['aug', 'may', 'feb']);
    expect(ids).toHaveLength(3 + PAST_EVENTS_LIMIT + 2);
    expect(ids).not.toContain('draft-old');
    expect(ids).not.toContain('pulled-future');
    expect(ids).not.toContain('live');
  });

  it('an event starting this very minute is not past yet', () => {
    expect(selectArchiveEvents([ev('now', 'published', NOW)], NOW)).toEqual([]);
    expect(
      selectArchiveEvents([ev('just', 'published', new Date(NOW.getTime() - 1))], NOW),
    ).toHaveLength(1);
  });

  it('never lists fewer than the home strip shows', () => {
    const events = [
      ev('a', 'archived', day(-1)),
      ev('b', 'published', day(-2)),
      ev('c', 'archived', day(-3)),
    ];
    const strip = selectHomeEvents(events, NOW).past.map((e) => e.id);
    const archive = selectArchiveEvents(events, NOW).map((e) => e.id);
    expect(archive.slice(0, strip.length)).toEqual(strip);
  });
});
