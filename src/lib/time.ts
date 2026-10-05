import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { Locale } from '@/i18n/locales';
import { toBanglaDigits } from '@/server/lib/digits';

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

/**
 * ISO 8601 with Dhaka's offset, e.g. "2026-10-10T19:00:00+06:00". For
 * machines that should also see the local time (structured data, ADR-042).
 */
export function toDhakaIso(date: Date): string {
  return formatInTimeZone(date, DHAKA_TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** Human display, e.g. "1 Oct 2026, 7:00 PM" (12-hour, ADR-060); Bangla "১ অক্টোবর ২০২৬, সন্ধ্যা ৭:০০". */
export function formatDhaka(date: Date, locale: Locale = 'en'): string {
  if (locale === 'bn') {
    const d = banglaParts(date);
    return `${d.day} ${d.month} ${d.year}, ${d.time}`;
  }
  return formatInTimeZone(date, DHAKA_TZ, 'd MMM yyyy, h:mm a');
}

/** Display with weekday, e.g. "Thu 1 Oct 2026, 7:00 PM" (B3/B4 headers); Bangla "বৃহস্পতিবার, ১ অক্টোবর ২০২৬, সন্ধ্যা ৭:০০". */
export function formatDhakaLong(date: Date, locale: Locale = 'en'): string {
  if (locale === 'bn') {
    const d = banglaParts(date);
    return `${d.weekday}বার, ${d.day} ${d.month} ${d.year}, ${d.time}`;
  }
  return formatInTimeZone(date, DHAKA_TZ, 'EEE d MMM yyyy, h:mm a');
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

/** Just the Dhaka clock time, e.g. "8:51 PM" (the gate's "already in" answer); Bangla "রাত ৮:৫১". */
export function formatDhakaClock(date: Date, locale: Locale = 'en'): string {
  if (locale === 'bn') return banglaParts(date).time;
  return formatInTimeZone(date, DHAKA_TZ, 'h:mm a');
}

/** Short weekday form for prose, e.g. "Thu 1 Oct, 7:00 PM" (B5 "dates in plain words"); Bangla "বৃহস্পতি, ১ অক্টোবর, সন্ধ্যা ৭:০০". */
export function formatDhakaShort(date: Date, locale: Locale = 'en'): string {
  if (locale === 'bn') {
    const d = banglaParts(date);
    return `${d.weekday}, ${d.day} ${d.month}, ${d.time}`;
  }
  return formatInTimeZone(date, DHAKA_TZ, 'EEE d MMM, h:mm a');
}

/*
 * ADR-061: Bangla dates and times, by hand — `Intl` prints `৭:৩০ PM` (Latin
 * PM) and phones ship different data, so server and browser would differ.
 * Gregorian months and weekdays in Bangla (not the Bangla calendar), and the
 * time of day as people say it instead of AM/PM.
 */
const BN_MONTHS = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
];
/** ISO weekday 1 (Monday) … 7 (Sunday); "বার" is added for the long form. */
const BN_WEEKDAYS = ['সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি', 'রবি'];

/**
 * The part of the day for a Dhaka hour (0–23): ভোর 4–6, সকাল 6–12,
 * দুপুর 12–3 PM, বিকেল 3–6 PM, সন্ধ্যা 6–8 PM, রাত 8 PM–4 AM.
 */
export function banglaDayPart(hour: number): string {
  if (hour >= 4 && hour < 6) return 'ভোর';
  if (hour >= 6 && hour < 12) return 'সকাল';
  if (hour >= 12 && hour < 15) return 'দুপুর';
  if (hour >= 15 && hour < 18) return 'বিকেল';
  if (hour >= 18 && hour < 20) return 'সন্ধ্যা';
  return 'রাত';
}

function banglaParts(date: Date) {
  const [year, month, day, hour, minute, isoDay] = formatInTimeZone(
    date,
    DHAKA_TZ,
    'yyyy M d H mm i',
  ).split(' ');
  const h = Number(hour);
  return {
    year: toBanglaDigits(year!),
    month: BN_MONTHS[Number(month) - 1]!,
    day: toBanglaDigits(day!),
    weekday: BN_WEEKDAYS[Number(isoDay) - 1]!,
    time: `${banglaDayPart(h)} ${toBanglaDigits(`${h % 12 || 12}:${minute}`)}`,
  };
}
