import { describe, expect, it } from 'vitest';
import { CLOSING_SOON_HOURS, eventPhase, ticketAvailability } from '@/server/lib/event-phase';

const H = 3_600_000;
const now = new Date('2026-09-18T10:00:00Z');
const at = (hoursFromNow: number) => new Date(now.getTime() + hoursFromNow * H);

const base = {
  event: {
    startsAt: at(24 * 13), // 13 days out
    registrationOpensAt: at(-24 * 7),
    registrationClosesAt: at(24 * 8),
  },
  availableTotal: 100,
  now,
};

describe('eventPhase', () => {
  it('is open in the middle of a healthy window', () => {
    expect(eventPhase(base)).toBe('open');
  });

  it('is not_open before registration opens, and at a missing window', () => {
    expect(eventPhase({ ...base, event: { ...base.event, registrationOpensAt: at(1) } })).toBe(
      'not_open',
    );
    expect(eventPhase({ ...base, event: { ...base.event, registrationOpensAt: null } })).toBe(
      'not_open',
    );
    // Opening exactly now counts as open.
    expect(eventPhase({ ...base, event: { ...base.event, registrationOpensAt: now } })).toBe(
      'open',
    );
  });

  it('is closing_soon strictly under 48h before close', () => {
    expect(
      eventPhase({ ...base, event: { ...base.event, registrationClosesAt: at(CLOSING_SOON_HOURS) } }),
    ).toBe('open');
    expect(
      eventPhase({
        ...base,
        event: { ...base.event, registrationClosesAt: at(CLOSING_SOON_HOURS - 0.01) },
      }),
    ).toBe('closing_soon');
  });

  it('is closed once registration has closed — closing exactly now is closed', () => {
    expect(eventPhase({ ...base, event: { ...base.event, registrationClosesAt: now } })).toBe(
      'closed',
    );
    expect(eventPhase({ ...base, event: { ...base.event, registrationClosesAt: at(-1) } })).toBe(
      'closed',
    );
  });

  it('is sold_out when nothing is available, even if closing soon', () => {
    expect(
      eventPhase({
        ...base,
        availableTotal: 0,
        event: { ...base.event, registrationClosesAt: at(2) },
      }),
    ).toBe('sold_out');
  });

  it('is past once the event has started, whatever else is true', () => {
    expect(
      eventPhase({ ...base, availableTotal: 0, event: { ...base.event, startsAt: now } }),
    ).toBe('past');
    expect(eventPhase({ ...base, event: { ...base.event, startsAt: at(-1) } })).toBe('past');
  });
});

describe('ticketAvailability', () => {
  const type = {
    quantityTotal: 400,
    quantitySold: 268,
    quantityReserved: 4,
    salesStartsAt: null,
    salesEndsAt: null,
  };

  it('counts what is left, excluding holds', () => {
    expect(ticketAvailability(type, now)).toEqual({ kind: 'left', count: 128 });
  });

  it('maps sale states to the public wording', () => {
    expect(ticketAvailability({ ...type, quantitySold: 396 }, now)).toEqual({ kind: 'sold_out' });
    expect(ticketAvailability({ ...type, salesEndsAt: at(-1) }, now)).toEqual({ kind: 'closed' });
    expect(ticketAvailability({ ...type, salesStartsAt: at(1) }, now)).toEqual({
      kind: 'not_started',
    });
  });
});
