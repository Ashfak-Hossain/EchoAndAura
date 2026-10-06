---
id: ADR-025
title: 'Settings (B14): one typed row, env as the fallback, read per request and per email job'
date: 2026-09-21
status: accepted
area: Admin
supersedes: []
extends: []
---

# ADR-025 — Settings (B14): one typed row, env as the fallback, read per request and per email job

**Date:** 2026-09-21 · **Status:** Accepted

**Context:** The bKash number, support contact, Facebook page, verification
promise and organizer name were env variables and `site.ts` constants, and
"Raj" was a literal in three email templates. The organizer could not change
his own receiving number without a deploy. Design B14 is one screen with
those fields, each helper naming where the value appears.

**Decision:**

- **A single typed row.** `settings` has a column per field and
  `CHECK (id = 1)`, not a key/value table: every consumer gets a typed
  `SiteSettings` and the compiler knows which fields exist. All value
  columns are nullable — **NULL means "use the fallback"**.
- **Env is the seed, the row is the truth.** Until the organizer has saved
  once, `resolveSettings` (pure) reads `BKASH_RECEIVE_NUMBER`,
  `ORGANIZER_CONTACT_EMAIL`, `ORGANIZER_PHONE` and `FACEBOOK_PAGE_URL`, so a
  fresh database (CI, the e2e database, a new install) behaves exactly as
  before with no seed step, and the form pre-fills those values. The first
  save copies them into the row; **after that a NULL column means "none"**
  (hide the Facebook link, no phone), never "go back to env" — the first cut
  did fall back per field, and clearing the Facebook link was silently
  undone on the next render (found in review). The verification promise and
  the organizer name are required on the form; their `site.ts` constants
  remain only for a row that predates the rule.
- **Read per request in the app** (`getSiteSettings`, React `cache()` — one
  query however many components ask) and **per job in the worker**
  (`DispatchEnv.settings()`), so a change is live on the next page and the
  next email with no restart. The cost is one single-row SELECT per request.
- **Account type drives buyer wording.** `bkash_account_type`
  (`personal` | `merchant`) flips "Send Money" ↔ "Payment" on the order page
  and in C1, and the account name is shown beside the number so a buyer can
  check who they are paying. Numbers are stored in the display form
  "01712 345678" (normalised through the same `bdMobile` rule registration
  uses) — the form people copy into bKash; `tel:` links strip the space.
- **Templates take a `sender`** (`EmailSender`: site URL, support email and
  phone, organizer name and address) instead of three loose props, and the
  organizer's name replaces the "Raj" literals. `ContactCard` and the
  check-in print sheet take settings as a prop so they stay pure.
- **Who saved it** is on the row (`updated_by`, `updated_at`) and in the log
  (which fields changed, never the values). No history table.
- **Not built:** the design's "Send myself a test email" (`pnpm email:test`
  covers it for now); `REPLY_PROMISE` and the policy constants that mirror
  code rules (`HOLD_HOURS`, `REGISTRATION_CLOSES_DAYS_BEFORE`,
  `REFUND_WORKING_DAYS`) stay in `site.ts` — they are not organizer choices.

**Consequences:** Migration `0011` must run before the app boots — `get()`
on a missing table throws. `SiteShell`, the public layout and every public
page that quotes a setting are async server components reading
`getSiteSettings()`. The e2e database truncates `settings` per run. Deleting
the row is the way back to the env seed; blanking a field means "none".

**Revisit when:** Raj asks "what was it before" (a `settings_history`
table or audit rows), a second organizer needs their own settings, or the
test-email button is wanted (a queue job kind, not a synchronous send).
