import { describe, expect, it } from 'vitest';
import {
  formatDhaka,
  formatDhakaClock,
  formatDhakaLong,
  formatDhakaShort,
  fromDhakaInput,
  toDhakaInput,
  toDhakaIso,
} from '@/lib/time';

/** A Dhaka wall-clock time ("2026-10-01T19:00") as the UTC instant. */
const at = (dhaka: string) => fromDhakaInput(dhaka);

describe('12-hour Dhaka time (ADR-060)', () => {
  it('prints each form with AM/PM and no leading zero', () => {
    const show = at('2026-10-01T19:00');
    expect(formatDhaka(show)).toBe('1 Oct 2026, 7:00 PM');
    expect(formatDhakaLong(show)).toBe('Thu 1 Oct 2026, 7:00 PM');
    expect(formatDhakaShort(show)).toBe('Thu 1 Oct, 7:00 PM');
    expect(formatDhakaClock(at('2026-10-01T20:51'))).toBe('8:51 PM');
  });

  it('noon is 12 PM and midnight 12 AM — where 12-hour clocks go wrong', () => {
    expect(formatDhakaClock(at('2026-10-01T12:00'))).toBe('12:00 PM');
    expect(formatDhakaClock(at('2026-10-01T00:00'))).toBe('12:00 AM');
    expect(formatDhakaClock(at('2026-10-01T00:30'))).toBe('12:30 AM');
    expect(formatDhakaClock(at('2026-10-01T11:59'))).toBe('11:59 AM');
    expect(formatDhakaClock(at('2026-10-01T13:05'))).toBe('1:05 PM');
    expect(formatDhakaClock(at('2026-10-01T23:59'))).toBe('11:59 PM');
  });

  it("is Dhaka's clock and day, whatever the UTC date", () => {
    // 18:30 UTC is 00:30 the next day in Dhaka (+06:00).
    expect(formatDhaka(new Date('2026-10-12T18:30:00Z'))).toBe('13 Oct 2026, 12:30 AM');
  });

  it('machine formats stay 24-hour', () => {
    const late = at('2026-10-01T21:15');
    expect(toDhakaInput(late)).toBe('2026-10-01T21:15');
    expect(toDhakaIso(late)).toBe('2026-10-01T21:15:00+06:00');
  });
});
