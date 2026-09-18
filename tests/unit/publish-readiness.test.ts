import { describe, expect, it } from 'vitest';
import { publishReadiness } from '@/server/lib/publish-readiness';

const now = new Date('2026-09-18T10:00:00Z');
const ready = {
  event: {
    startsAt: new Date('2026-10-01T13:00:00Z'),
    registrationOpensAt: new Date('2026-09-11T13:00:00Z'),
    registrationClosesAt: new Date('2026-09-26T13:00:00Z'),
    imageKey: 'events/e1/cover-abc.jpg',
  },
  ticketTypeCount: 3,
  now,
};

const codes = (input: Parameters<typeof publishReadiness>[0]) =>
  publishReadiness(input).map((p) => p.code);

describe('publishReadiness', () => {
  it('returns no problems for a well-formed event with ticket types', () => {
    expect(publishReadiness(ready)).toEqual([]);
  });

  it('requires at least one ticket type', () => {
    expect(codes({ ...ready, ticketTypeCount: 0 })).toEqual(['no_ticket_types']);
  });

  it('requires a cover image', () => {
    expect(codes({ ...ready, event: { ...ready.event, imageKey: null } })).toEqual([
      'no_cover_image',
    ]);
  });

  it('requires the start to be in the future — starting exactly now is too late', () => {
    expect(codes({ ...ready, event: { ...ready.event, startsAt: now } })).toContain(
      'starts_in_past',
    );
    expect(
      codes({
        ...ready,
        event: { ...ready.event, startsAt: new Date(now.getTime() + 1) },
      }),
    ).not.toContain('starts_in_past');
  });

  it('requires a valid registration window', () => {
    const e = ready.event;
    // Missing either bound.
    expect(codes({ ...ready, event: { ...e, registrationOpensAt: null } })).toEqual([
      'registration_window_invalid',
    ]);
    expect(codes({ ...ready, event: { ...e, registrationClosesAt: null } })).toEqual([
      'registration_window_invalid',
    ]);
    // Opens after (or at) close.
    expect(
      codes({
        ...ready,
        event: { ...e, registrationOpensAt: e.registrationClosesAt },
      }),
    ).toEqual(['registration_window_invalid']);
    // Closes after the event starts.
    expect(
      codes({
        ...ready,
        event: { ...e, registrationClosesAt: new Date('2026-10-01T13:00:01Z') },
      }),
    ).toEqual(['registration_window_invalid']);
    // Closing exactly at start is allowed.
    expect(codes({ ...ready, event: { ...e, registrationClosesAt: e.startsAt } })).toEqual([]);
  });

  it('reports every problem at once, in checklist order, with messages', () => {
    const problems = publishReadiness({
      event: {
        startsAt: new Date('2020-01-01T00:00:00Z'),
        registrationOpensAt: null,
        registrationClosesAt: null,
        imageKey: null,
      },
      ticketTypeCount: 0,
      now,
    });
    expect(problems.map((p) => p.code)).toEqual([
      'no_ticket_types',
      'no_cover_image',
      'starts_in_past',
      'registration_window_invalid',
    ]);
    for (const p of problems) expect(p.message.length).toBeGreaterThan(0);
  });
});
