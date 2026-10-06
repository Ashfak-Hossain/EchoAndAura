---
id: ADR-023
title: 'Check-in list (B11): unpaginated in-memory list, a separate print sheet, partial lists label themselves'
date: 2026-09-21
status: partly-superseded
area: Admin
supersedes: []
extends: []
---

# ADR-023 — Check-in list (B11): unpaginated in-memory list, a separate print sheet, partial lists label themselves

**Date:** 2026-09-21 · **Status:** Accepted — the list is now the backup to the gate scanner ([ADR-030](030-gate-scanner-slice-a.md))

**Context:** Check-in at the gate is a printed or exported list (no QR
scanning). Door staff need one sheet per event with attendee, ticket type,
code and order reference, a box to tick, and the same as a CSV. The list
is looked up by name, but people also read out a code or a reference.

**Decision:**

- **Whole list, no pagination.** `ticketsRepository.listForEvent` returns
  every ticket of the event (all statuses, joined to the order reference
  and type name — never the buyer's email or phone: the sheet is handed
  around). The service keeps `issued` only, counts `cancelled` for the
  footer, and searches and sorts **in memory** from the URL (`?q=&sort=`)
  with the pure helpers in `src/server/lib/check-in.ts`. A door list is
  bounded by the event's capacity and has to be printed whole, so there is
  nothing to paginate; a cap with a warning row (as the orders export has)
  is the change to make if an event ever runs to tens of thousands.
- **One term, every reading.** `normaliseCheckInQuery` reads a term as a
  name substring (case- and whitespace-insensitive, so Bangla names work),
  as a ticket code (`TKT-` optional, spaces ignored — codes are read aloud
  in groups) and as an order reference (`EA-` optional); every reading that
  parses is kept and ORed, as the orders search does (ADR-021).
- **The print sheet is its own table**, `hidden print:block`, not print CSS
  on the DataTable: that table is `hidden lg:flex`, and an A4 page is
  narrower than `lg`, so in print it would vanish and the phone list would
  print instead. The sheet is always **name A–Z** whatever the screen is
  sorted by, has a 28 px tick box, a repeating `<thead>`, the count and the
  time the data was read ("as of"), and the footer from the design.
  **Page numbers are not printed**: they need `@page` margin boxes, which
  Chrome and Safari do not implement.
- **A filtered list is never printed silently.** The Print button is
  disabled while a search is in force, and because ⌘P bypasses the button
  the sheet labels itself "Partial list — search … applied" with
  "N of M names". A subset that looks like the whole list turns paying
  attendees away at the door; found in review.
- **CSV** (`/admin/events/[id]/check-in/export.csv`) mirrors the orders
  export: `requireAdmin()` in the handler, `toCsv` (BOM, CRLF, formula-safe),
  the same search and sort as the page, and an empty `checked_in` column to
  tick in a spreadsheet. The log records that a filter was used, not the
  term (it is usually a name).
- **No row selection yet.** The design's on-screen tick column would
  persist nothing; selection arrives with cancel ticket, when there is
  something to do with a selection. Entry point: a "Check-in list" button
  in the event editor header for published and archived events (the
  archived design promises the list stays available); no sidebar item.
- **`SearchBox`** (`src/components/admin/search-box.tsx`) is the debounced
  search extracted from the orders toolbar. It follows the URL when the URL
  moves without it (a Clear link, the back button, a superseded push) and
  never overwrites a term still being typed; the toolbar's own Clear
  remounts it so a pending debounce dies with it. The first cut re-applied
  a stale term after a soft navigation — a flake in the full e2e run, and
  a real bug.

**Consequences:** Ticket codes on paper are access keys to the web ticket
page (by design, ADR-015); the sheet can be printed before registration
closes, so a name printed early may be renamed later — the footer says to
reprint on the day. `TicketsRepository` gains one read method; the fake in
`tests/unit/helpers/fake-db.ts` mirrors it.

**Revisit when:** an event's capacity makes the unpaginated page heavy
(cap + warning, select only the columns the list needs), or door staff
want to mark arrivals in the app (then row selection and a
`checked_in_at` column).
