import { describe, expect, it } from 'vitest';
import type { EventStatus } from '@/server/lib/event-status';
import {
  PAST_EVENTS_LIMIT,
  UPCOMING_EVENTS_LIMIT,
  selectArchiveEvents,
  selectHomeEvents,
} from '@/server/lib/home-events';

const NOW = new Date('2026-09-18T10:00:00Z');
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000);
const ev = (id: string, status: EventStatus, startsAt: Date) => ({ id, status, startsAt });

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

  it('caps "also upcoming" so a busy season never becomes a directory', () => {
    const many = Array.from({ length: UPCOMING_EVENTS_LIMIT + 3 }, (_, i) =>
      ev(`u${i}`, 'published', day(i + 1)),
    );
    const sel = selectHomeEvents(many, NOW);
    expect(sel.featured?.id).toBe('u0');
    expect(sel.alsoUpcoming).toHaveLength(UPCOMING_EVENTS_LIMIT);
    expect(sel.alsoUpcoming[0]?.id).toBe('u1');
  });

  it('past strip: newest first, published or archived, capped', () => {
    const many = Array.from({ length: PAST_EVENTS_LIMIT + 2 }, (_, i) =>
      ev(`p${i}`, i % 2 ? 'archived' : 'published', day(-(i + 1) * 10)),
    );
    const sel = selectHomeEvents(many, NOW);
    expect(sel.past).toHaveLength(PAST_EVENTS_LIMIT);
    expect(sel.past.map((e) => e.id)).toEqual(['p0', 'p1', 'p2']);
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
