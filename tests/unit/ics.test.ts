import { describe, expect, it } from 'vitest';
import { buildTicketIcs } from '@/server/lib/ics';

const base = {
  code: 'TKT-4H8ZP2XQ',
  eventTitle: 'Echo & Aura Live — Dhaka; night 1, 2026',
  venue: 'ICCB Hall 4, Dhaka',
  startsAt: new Date('2026-10-01T13:00:00Z'),
  endsAt: null,
  url: 'https://echoandaura.com/tickets/TKT-4H8ZP2XQ',
  attendeeName: 'Nusrat Jahan',
};

describe('buildTicketIcs', () => {
  it('emits one VEVENT with UTC stamps, a stable UID and a default 3h duration', () => {
    const ics = buildTicketIcs(base, new Date('2026-09-17T05:20:00Z'));
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('UID:TKT-4H8ZP2XQ@echoandaura');
    expect(ics).toContain('DTSTAMP:20260917T052000Z');
    expect(ics).toContain('DTSTART:20261001T130000Z');
    expect(ics).toContain('DTEND:20261001T160000Z');
    expect(ics).toContain('LOCATION:ICCB Hall 4\\, Dhaka');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('escapes commas and semicolons, uses the real end when present, folds long lines', () => {
    const ics = buildTicketIcs({ ...base, endsAt: new Date('2026-10-01T16:30:00Z') });
    expect(ics).toContain('SUMMARY:Echo & Aura Live — Dhaka\\; night 1\\, 2026');
    expect(ics).toContain('DTEND:20261001T163000Z');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });

  it('folds by octets, never splitting a multi-byte character', () => {
    const ics = buildTicketIcs({
      ...base,
      eventTitle: 'ইকো অ্যান্ড অরা লাইভ — ঢাকা, রাত এক · '.repeat(4) + '🎸🎤🎶'.repeat(10),
    });
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    // Unfolding restores the exact text: no U+FFFD from a split surrogate.
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).not.toContain('\uFFFD');
    expect(unfolded).toContain('🎸🎤🎶');
  });
});
