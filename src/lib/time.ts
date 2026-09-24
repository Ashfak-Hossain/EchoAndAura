import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/**
 * Every wall-clock time the organizer types or reads is Dhaka time; storage is
 * UTC (`timestamptz`). These helpers are the only place that boundary is
 * crossed, so a page never has to reason about offsets.
 */
export const DHAKA_TZ = 'Asia/Dhaka';

/** Value format produced/consumed by `<input type="datetime-local">`. */
export const DATETIME_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

/** "2026-10-01T19:00" (typed as Dhaka wall time) → the UTC instant. */
export function fromDhakaInput(value: string): Date {
  return fromZonedTime(value, DHAKA_TZ);
}

/** UTC instant → "2026-10-01T19:00" for prefilling a datetime-local input. */
export function toDhakaInput(date: Date): string {
  return formatInTimeZone(date, DHAKA_TZ, "yyyy-MM-dd'T'HH:mm");
}

/** The Dhaka calendar day of an instant, as `yyyy-MM-dd` (B12 buckets; 18:00Z is already tomorrow). */
export function dhakaDay(date: Date): string {
  return formatInTimeZone(date, DHAKA_TZ, 'yyyy-MM-dd');
}

/** Human display, e.g. "1 Oct 2026, 19:00". */
export function formatDhaka(date: Date): string {
  return formatInTimeZone(date, DHAKA_TZ, 'd MMM yyyy, HH:mm');
}

/** Display with weekday, e.g. "Thu 1 Oct 2026, 19:00" (B3/B4 headers). */
export function formatDhakaLong(date: Date): string {
  return formatInTimeZone(date, DHAKA_TZ, 'EEE d MMM yyyy, HH:mm');
}

/** "8 min ago", "Yesterday", or a Dhaka date once it is older than a week (B4 "Updated"). */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return formatInTimeZone(date, DHAKA_TZ, 'd MMM yyyy');
}

/** Just the Dhaka clock time, e.g. "20:51" (the gate's "already in" answer). */
export function formatDhakaClock(date: Date): string {
  return formatInTimeZone(date, DHAKA_TZ, 'HH:mm');
}

/** Short weekday form for prose, e.g. "Thu 1 Oct, 19:00" (B5 "dates in plain words"). */
export function formatDhakaShort(date: Date): string {
  return formatInTimeZone(date, DHAKA_TZ, 'EEE d MMM, HH:mm');
}
