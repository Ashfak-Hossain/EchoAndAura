/**
 * The numbers and names the site's copy quotes — policy pages, FAQ, the
 * order page. One place, so when the organizer changes a promise (the
 * verification SLA, the refund turnaround) every page that states it
 * changes together. Business promises, not code constants: the rename window
 * mirrors the rule in src/server/lib, and a change there must be mirrored
 * here. The hold is the rule itself (below).
 */

/**
 * Verification SLA agreed with the organizer (PHASES.md risk register).
 * Since B14 this is only the FALLBACK: the live value is
 * `settings.verificationPromise` (`getSiteSettings()`), which the organizer
 * edits at /admin/settings. Same for ORGANIZER_NAME below.
 */
export const VERIFICATION_SLA = 'usually within 4 hours, always within a day';

/**
 * How long an unpaid order holds its tickets (ADR-054). Re-exported from the
 * rule itself, so the copy can never promise a different hold.
 */
export { HOLD_MINUTES } from '@/server/lib/hold';

/** Working days for a refund by bKash after a rejected-but-debited payment or a cancelled event. */
export const REFUND_WORKING_DAYS = 3;

/** Registration (and therefore ticket renaming) closes this many days before the event. */
export const REGISTRATION_CLOSES_DAYS_BEFORE = 5;

/** How the organizer is addressed in copy — fallback for `settings.organizerName`. */
export const ORGANIZER_NAME = 'Raj';

/** Reply-time promise on the contact card. */
export const REPLY_PROMISE = 'replies within a day';

/** "Last updated" per policy page — bump when the wording changes. (About shows none.) */
export const LAST_UPDATED = {
  terms: new Date('2026-09-25T00:00:00+06:00'),
  privacy: new Date('2026-09-25T00:00:00+06:00'),
  refund: new Date('2026-09-25T00:00:00+06:00'),
} as const;
