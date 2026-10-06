---
id: ADR-030
title: 'Gate scanner (Slice A): gate passes, one atomic check-in, a self-hosted decoder'
date: 2026-09-24
status: partly-superseded
area: Gate scanner
supersedes: [ADR-009, ADR-015, ADR-023]
extends: []
---

# ADR-030 — Gate scanner (Slice A): gate passes, one atomic check-in, a self-hosted decoder

**Date:** 2026-09-24 · **Status:** Accepted, partly superseded by [ADR-034](034-gate-scanner-offline.md) (a sync request may carry up to 50 offline scans) · supersedes the scanner parts of ADR-015 and ADR-023

**Context:** The organizer wants tickets scanned at the gate, from phones,
at several gates at once. Until now the rule was "no scanning — a printed
list". Every ticket's QR already encodes only its code (ADR-015), and that
code is in every PDF and email already sent, so a scanner can read the
tickets people already hold. Planned with four research agents and two
adversarial plan reviews; built in two slices — this one online, Slice B
an offline fallback.

**Decision:**

- **Gate passes, not staff accounts.** `door_passes` (migration `0018`):
  one event, one gate label, a 12-symbol code from the ticket alphabet
  (~59 bits, UNIQUE, CHECK on the format). The entropy is the defence; the
  sign-in throttle only keeps noise down, and counts only WRONG codes — door
  phones share the venue's IP with everyone there, so a stranger's guesses
  must never lock a right code out. The code is stored in **plain
  text** so the organizer can show it again to a replacement phone — it is
  shown only on the admin check-in page. A pass works from 4 h before the
  start ("practice" before that: answered and logged, never checked in)
  until 6 h after the end (with no end time the end is taken as start + 6 h,
  so start + 12 h). The window is
  **derived from the event's current dates on every request, never
  stored**, so moving the event can never strand a pass. A draft event
  refuses its passes; an archived one keeps scanning until the window ends
  (archiving promises issued tickets stay valid).
- **The credential is an httpOnly cookie scoped to `Path=/door`**,
  `SameSite=Lax` (a pass link opened from WhatsApp must carry it), `Secure`
  from the request protocol, `Max-Age` to the window's end. The pass link is
  `/door#code=…` — a fragment never reaches the server or its logs, and the
  page wipes it with `replaceState`. It is a different credential from any
  better-auth session, so a door phone can never reach `/admin`.
- **The door API is route handlers under `/door/api/*`, not Server
  Actions**: a door tab stays open all night, and action ids change on every
  deploy. Every write is a same-origin JSON POST/DELETE (content type and
  `Origin` host checked — route handlers get no built-in CSRF check).
  Responses are `no-store`; `/door/*` sends `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `Permissions-Policy: camera=(self)`.
- **One atomic check-in** — the Invariant 2 pattern: `UPDATE tickets SET
checked_in_* WHERE id AND status = 'issued' AND checked_in_at IS NULL
RETURNING`. Of any number of simultaneous scans exactly one admits; the
  rest re-read inside the same transaction and answer ALREADY IN with the
  winner's time and gate. Two CHECKs backstop it: the three `checked_in_*`
  columns are all set or all null, and a checked-in ticket must be `issued`
  (so it can never be cancelled). `cancel` requires `checked_in_at IS NULL`
  and `fulfilment.cancelTicket` refuses with "admitted 20:51 · Gate A — undo
  the check-in first".
- **Inside a scan transaction only tx-bound statements run.** The pool has
  10 connections; a pool read from inside a transaction that is waiting on
  a ticket row lock could starve it. The integration test runs 12 parallel
  scans of one ticket to prove it finishes.
- **The pass is locked, not just read.** The first statement of every scan
  (and door-undo) transaction is `SELECT … FROM door_passes WHERE id AND
revoked_at IS NULL FOR SHARE`. Scans on one pass never block each other,
  but a revoke (NO KEY UPDATE) waits for the ones in flight, so
  revoke-and-undo sees every check-in they make, and any scan after it finds
  the pass revoked (401). Lock order is pass → ticket everywhere.
- **Every undo is a compare-and-swap on one check-in** (`undoCheckIn(id,
scanId)`): the door's own admit, the one the admin's page showed, the ones
  a revoked pass made. None can clear a later, legitimate check-in; the
  admin's audit note records which check-in (time · gate) was taken back.
- **Every answered scan is logged in `door_scans`** (append-only, all foreign
  keys RESTRICT): result, method (qr/typed/search), mode
  (online/offline/practice), the earlier check-in shown on an ALREADY IN,
  the device clock (advisory) and `received_at`. Stray QR text is never
  stored — only the parsed ticket code, or `<unparsed:len=N>`. Every
  check-in and every undo also writes an `order_events` row (Invariant 6 in
  spirit; the order status does not change). Refused requests (401, 403,
  429, 400) and replays write nothing.
- **Idempotent by a phone-generated `scanId`** (UNIQUE). A retry — the Retry
  button, or re-reading the same code within 2 minutes after no answer —
  sends the same id, and the server replays the stored answer: the person
  just admitted is never turned away by their own retry. A replayed ADMIT
  is green only for the Retry button; from a fresh read it shows amber
  ("admitted N s ago — same person?"), because it could be a second person
  with a screenshot; and it replays only while that very check-in stands —
  once undone, the answer is "scan again". The same id with
  other input or from another pass answers `scan_id_conflict`; a scan
  racing its own retry loses on the UNIQUE index, rolls back and replays
  the winner.
- **Answers never carry a ticket code or buyer contact details** (a test
  asserts no `TKT-` in the JSON). A wrong-event answer names only the other
  event's title, and the gate's recent-scans list joins only this event's
  tickets. Name search (a POST, so names never sit in URLs or access logs)
  matches the name OR a code ("mahmudur" is also 8 letters of the code
  alphabet). A **search admit** is the easiest fraud: staff ask for the last
  3 digits of the phone that bought the ticket and type what they hear; the
  server checks them (`phone_mismatch` is refused and logged). The digits are
  never sent to the door phone — an impostor could read them off the screen.
  A comp has no phone to check. Search admits have their own tighter budget.
- **Logs never carry a pass or ticket code.** Drizzle's query errors end
  with the bound params; door code logs through `safeErrorShape`, which
  drops them. The cookie is `Secure` whenever SITE_URL is HTTPS (like
  better-auth's), not only when a proxy says so.
- **Rate limits fail open** (`src/lib/door-limits.ts`): a Redis blip must
  never stop a gate. Code entry 20 per 10 min per IP; scans 240/min, search
  admits 20/min and searches 60/min per pass. 429 carries `Retry-After`.
- **Undo:** the door may undo its own admit for 2 minutes with a reason from
  a short list (a mis-tap, the wrong person) — long enough to fix a slip,
  too short to recycle a ticket. The organizer can undo any check-in on the
  order page, and **Revoke and undo** a leaked pass: revoke it and take back
  every check-in it still holds, each audited.
- **Decoder:** iOS Safari has no `BarcodeDetector`, so the page uses the
  `barcode-detector` 3.2.2 ponyfill over `zxing-wasm` 3.1.3 (zxing-cpp in
  WebAssembly), pinned exactly, loaded with a dynamic import on `/door`
  only. The `.wasm` is **served from our origin**
  (`public/vendor/zxing_reader-3.1.3.wasm`), never jsDelivr; a unit test
  checks its SHA-256 against the package's `ZXING_WASM_SHA256`. A future
  Content-Security-Policy must allow `'wasm-unsafe-eval'` on `/door`.
- **The QR stays unsigned.** ADR-015 said a scanner would need a signed QR.
  Online, every scan is checked against the database and the ~40-bit codes
  are UNIQUE, so a signature adds nothing — and keeping the QR means no PDF
  or email has to be reissued. A shared screenshot is handled by
  first-scan-wins, with the attendee's name shown on ALREADY IN. The
  offline case is Slice B's problem.
- **Door phone UX:** one Start tap opens the rear camera, unlocks sound
  (`navigator.audioSession.type = 'playback'` so iPhones beep on silent; an
  `<audio>` fallback before Safari 17) and takes the wake lock; hidden page →
  everything released → "Tap to resume". About 10 decodes a second, one at a
  time, auto-pause after 2 idle minutes, and "Tap to resume" if frames stop
  for 3 s (a call banner, Siri). Sound unlocks on the first tap or key of
  any kind. Duplicate camera reads are ignored while the code stays in view
  (a code that comes back goes to the server, which answers amber at this
  gate — that is how a handed-back screenshot is caught), and while a
  full-screen panel hides the viewfinder;
  typed and handheld (keyboard-wedge, caught at the document, no hidden
  field) codes always go to the server. Full-screen answers: green ADMIT
  (clears itself), amber "admitted N s ago at this gate", red ALREADY IN /
  CANCELLED / WRONG EVENT / NOT A VALID TICKET, blue PRACTICE. In-app
  browsers (Messenger, Instagram…) get an "open in Safari or Chrome" card.
- **Admin:** the check-in page gains the gate-passes card (QR of the pass
  link, the code, tips), "N of M checked in", a Checked-in column and an
  All · In · Not yet filter that is treated like the search (Print disabled,
  "Partial list" on the sheet, carried into the CSV, whose `checked_in`
  column is now filled). The print sheet ticks people already in.

**Consequences:** The printed list is now the backup, not the process.
Tickets that are checked in cannot be cancelled until the check-in is
undone. The door needs signal; without it staff use the printed list until
Slice B. Phone testing needs HTTPS on a real host — a cloudflared quick
tunnel ([DEVELOPMENT.md](../DEVELOPMENT.md)); `next dev --experimental-https`
is not enough (its certificate is for localhost only).

**Revisit when:** Slice B (offline list + outbox + sync) is planned; or a
CSP is introduced; or gates need per-staff accountability (named staff
accounts instead of a shared pass).
