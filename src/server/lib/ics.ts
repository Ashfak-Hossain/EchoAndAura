import { addHours } from 'date-fns';

/**
 * "Add to calendar" for a ticket (A5). Pure: one VEVENT, UTC stamps,
 * UID = ticket code so re-importing updates rather than duplicates.
 * No end time on the event → assume three hours (a night of music).
 */
export interface TicketIcsInput {
  code: string;
  eventTitle: string;
  venue: string | null;
  startsAt: Date;
  endsAt: Date | null;
  /** Absolute URL of the ticket page. */
  url: string;
  attendeeName: string;
}

export const ICS_DEFAULT_DURATION_HOURS = 3;

function stamp(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** RFC 5545 text escaping. */
function esc(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * RFC 5545 §3.1: lines are at most 75 *octets*, folded with CRLF + one
 * space. Counted in UTF-8 bytes on code-point boundaries, so a Bengali
 * title (3 bytes a character) folds correctly and a surrogate pair is
 * never split.
 */
function fold(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    const limit = parts.length === 0 ? 75 : 74; // continuation lines carry a leading space
    if (bytes + n > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += n;
  }
  parts.push(current);
  return parts.map((p, i) => (i === 0 ? p : ` ${p}`)).join('\r\n');
}

export function buildTicketIcs(input: TicketIcsInput, now: Date = new Date()): string {
  const end = input.endsAt ?? addHours(input.startsAt, ICS_DEFAULT_DURATION_HOURS);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//echoandaura//tickets//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${input.code}@echoandaura`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(input.startsAt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(input.eventTitle)}`,
    ...(input.venue ? [`LOCATION:${esc(input.venue)}`] : []),
    `DESCRIPTION:${esc(`Ticket ${input.code} for ${input.attendeeName}. Show the name and code at the door.\n${input.url}`)}`,
    `URL:${input.url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
