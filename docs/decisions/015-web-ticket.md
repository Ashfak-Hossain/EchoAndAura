---
id: ADR-015
title: 'The web ticket: code as access key, on-demand PDF, rename until close, a QR without a scanner'
date: 2026-09-19
status: partly-superseded
area: Tickets and email
supersedes: []
extends: []
---

# ADR-015 — The web ticket: code as access key, on-demand PDF, rename until close, a QR without a scanner

**Date:** 2026-09-19 · **Status:** Accepted — the "no scanner" parts superseded by [ADR-030](030-gate-scanner-slice-a.md)

**Context:** Each issued ticket needs a page the attendee can show and
print (A5/C5), and the business rule says the buyer may edit the attendee
name until registration closes. CLAUDE.md rules "all I/O is queued" and
"no QR scanning at the gate".

**Decision:**

- **`/tickets/<code>` is keyed by the ticket code** (`TKT-` + 8 chars of a
  31-symbol alphabet, ~40 bits). It shows attendee, event, type and code —
  never the buyer's email or phone — and names the order reference as text,
  not a link, because the order page carries PII. Rate limiting the path is
  Phase 7 hardening.
- **The PDF renders on demand** (`GET /tickets/<code>/pdf`,
  `@react-pdf/renderer`, `serverExternalPackages`). One ticket is a single
  ~5 KB document with no external I/O: a page view, not the bulk work the
  "queue all I/O" rule protects against. The whole order's tickets are in
  the file, the requested one first. The component is plain React under
  `src/server/pdf/` so the email worker can attach the same document.
- **A `position` column on tickets** (migration `0006`, 1-based, fixed at
  issue) makes "ticket 2 of 3" stable — rows share a `created_at` and codes
  are random, so nothing else orders them. `0007` (custom) backfills
  existing rows by issue order; `0008` adds UNIQUE `(order_id, position)`
  and `CHECK (position >= 1)` so the fact lives in the database.
- **The PDF bundles Noto Sans + Noto Sans Bengali** (OFL) and picks the
  face per text run by script: react-pdf's built-in Helvetica is
  WinAnsi-only and renders a Bengali name as Latin-1 garbage — for a Dhaka
  audience that is most of the door list. Fonts load from disk, never the
  network (Invariant 7). Found in review.
- **Rename is allowed while `issued` and `now < registration_closes_at`**
  (a missing close date locks, never opens). It is a compare-and-swap
  UPDATE on `status = 'issued' AND attendee_name = <old>` plus an
  `order_events` row (`buyer / ticket.renamed`, "old → new") — not a status
  change, but the first thing Raj will ask at the door; the CAS means the
  audit row's old name is exact and a concurrent rename is refused, not
  overwritten. Anyone holding the code can rename — the business rule says
  "the buyer", but tickets are transferable and the code _is_ possession.
  The name rule (2–120, whitespace collapsed) lives in `attendee-name.ts`
  and is shared by Zod and the service.
- **The QR encodes the ticket code and nothing else**, generated
  server-side as SVG. Door staff work from the printed list by name and
  code; copy on page and PDF says so. It is a convenience for reading the
  code, never the only way in, and there is no scanner to build.
- `/tickets/<code>/calendar.ics` is a hand-built single VEVENT (UID = code).

**Consequences:** No storage of rendered PDFs; a buyer can regenerate one
forever. At most two PDFs render concurrently per process (a burst queues
rather than starving the order pages); `Cache-Control: private, max-age=60`.
Cancelled tickets render greyscale with a stamp (cancel itself is Phase 6).
The `.ics` folds by UTF-8 octets on code-point boundaries (RFC 5545 §3.1).

**Revisit when:** the check-in list (Phase 6) wants something beyond name +
code, or a scanner is ever requested (then the QR payload becomes signed).
