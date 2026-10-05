import { describe, expect, it } from 'vitest';
import {
  banglaDayPart,
  formatDhaka,
  formatDhakaClock,
  formatDhakaLong,
  formatDhakaShort,
  fromDhakaInput,
} from '@/lib/time';
import { groupDigits, toBanglaDigits } from '@/server/lib/digits';
import { formatBDT } from '@/server/lib/money';

const at = (dhaka: string) => fromDhakaInput(dhaka);

describe('Bangla formatting (ADR-061)', () => {
  it('dates and times in Bangla, with the part of the day people say', () => {
    const show = at('2026-10-10T19:30');
    expect(formatDhaka(show, 'bn')).toBe('১০ অক্টোবর ২০২৬, সন্ধ্যা ৭:৩০');
    expect(formatDhakaLong(show, 'bn')).toBe('শনিবার, ১০ অক্টোবর ২০২৬, সন্ধ্যা ৭:৩০');
    expect(formatDhakaShort(show, 'bn')).toBe('শনি, ১০ অক্টোবর, সন্ধ্যা ৭:৩০');
    expect(formatDhakaClock(at('2026-10-10T00:05'), 'bn')).toBe('রাত ১২:০৫');
    expect(formatDhakaClock(at('2026-10-10T12:00'), 'bn')).toBe('দুপুর ১২:০০');
    // English is unchanged by the new parameter.
    expect(formatDhaka(show)).toBe('10 Oct 2026, 7:30 PM');
  });

  it('the part-of-day boundaries are pinned', () => {
    const cases: [number, string][] = [
      [3, 'রাত'],
      [4, 'ভোর'],
      [5, 'ভোর'],
      [6, 'সকাল'],
      [11, 'সকাল'],
      [12, 'দুপুর'],
      [14, 'দুপুর'],
      [15, 'বিকেল'],
      [17, 'বিকেল'],
      [18, 'সন্ধ্যা'],
      [19, 'সন্ধ্যা'],
      [20, 'রাত'],
      [23, 'রাত'],
      [0, 'রাত'],
    ];
    for (const [hour, word] of cases) expect([hour, banglaDayPart(hour)]).toEqual([hour, word]);
  });

  it('digits and South Asian grouping', () => {
    expect(toBanglaDigits('2026, 7:05')).toBe('২০২৬, ৭:০৫');
    expect(groupDigits(100000, 'bn')).toBe('১,০০,০০০');
    expect(groupDigits(1234567, 'bn')).toBe('১২,৩৪,৫৬৭');
    expect(groupDigits(999, 'bn')).toBe('৯৯৯');
    expect(groupDigits(1234567)).toBe('1,234,567');
  });

  it('money in Bangla groups in lakhs; English is unchanged', () => {
    expect(formatBDT(12345600, 'bn')).toBe('৳১,২৩,৪৫৬.০০');
    expect(formatBDT(5, 'bn')).toBe('৳০.০৫');
    expect(formatBDT(12345600)).toBe('৳123,456.00');
    expect(formatBDT(123456)).toBe('৳1,234.56');
  });
});
