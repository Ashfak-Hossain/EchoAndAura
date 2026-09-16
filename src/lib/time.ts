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

/** Human display, e.g. "1 Oct 2026, 19:00". */
export function formatDhaka(date: Date): string {
  return formatInTimeZone(date, DHAKA_TZ, 'd MMM yyyy, HH:mm');
}
