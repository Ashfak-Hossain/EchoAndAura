---
id: ADR-060
title: 12-hour time for people, ASCII digits for checks
date: 2026-10-05
status: accepted
area: Localisation
supersedes: []
extends: []
---

# ADR-060 — 12-hour time for people, ASCII digits for checks

**Date:** 2026-10-05 · **Status:** Accepted · first slice of Phase 8 (localisation)

**Context:** The owner wants times in the form people here read them:
"7:00 PM", not "19:00". Separately, a buyer typing on a Bangla keyboard
enters `০১৭১২…`. JavaScript's `\d` matches ASCII digits only, so their
bKash number, TrxID, promo code or ticket code failed every check. The door
search even deleted the digits as they were typed.

**Decision:**

- **12-hour clock in every human-facing time.** The four formatters in
  `src/lib/time.ts` change their pattern from `HH:mm` to `h:mm a`:
  `1 Oct 2026, 7:00 PM`, `Thu 1 Oct, 7:00 PM`, `8:51 PM`. The hour has no
  leading zero, `AM`/`PM` are in capitals, noon is `12:00 PM` and midnight
  `12:00 AM` (pinned in `tests/unit/time.test.ts`). Pages, emails, the
  ticket PDF, the admin and the gate scanner all use these formatters, so
  their callers do not change.
- **Machine formats stay 24-hour:** CSV exports (`yyyy-MM-dd HH:mm`, so
  spreadsheets sort), ISO 8601 for structured data and calendar files, and
  `datetime-local` values (the device draws those inputs in its own
  format).
- **`normaliseDigits()`** (`src/server/lib/digits.ts`) maps Bangla `০-৯`,
  Arabic-Indic `٠-٩` and Persian `۰-۹` to ASCII. It runs before every
  numeric or code check:
  - the bKash phone (registration, payment, find order, admin search)
  - the TrxID (form and service)
  - quantity, promo code and order reference
  - typed ticket codes
  - the door's last three phone digits and its pass code
- What is stored and compared is always ASCII. A TrxID typed with Bangla
  digits reaches the UNIQUE index as the same bytes as its ASCII form, so
  Invariant 3 holds.

**Consequences:**

- Unit and e2e tests that pinned 24-hour text were updated, and
  `tests/unit/digits.test.ts` covers each input.
- The Bangla translation (later slices) will print Bangla digits through
  its own formatter, while input is accepted in any of these digit sets
  from now on.

**Rejected:** the browser's `Intl` time formatting (server and phone may
print different text, which causes hydration mismatches); Unicode-aware
`\p{Nd}` in each regex (it would accept the digits but store them as typed,
and the UNIQUE index would then treat `৯AB…` and `9AB…` as different).
