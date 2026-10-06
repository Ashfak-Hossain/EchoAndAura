---
id: ADR-055
title: Per-event option to hide how many tickets are left
date: 2026-10-04
status: accepted
area: Public site
supersedes: []
extends: []
---

# ADR-055 — Per-event option to hide how many tickets are left

**Date:** 2026-10-04 · **Status:** Accepted

**Context:** The organizer does not want scarcity to be visible on some
events: a public "12 left" can put buyers off as easily as it hurries
them. The count reached the public in five places: the home hero's
"N left" (ADR-020's `availableTotal`), the event page's ticket list (each
row's "N left", compact text and chip), the register page (per-type
"N left" and "left at this price", and the count itself in the page
payload, which sized the quantity stepper), and two emails — C3
(rejected: "N General tickets are still available") and C4 (expired:
"Still available: N General tickets").

**Decision (owner-chosen, 2026-10-04):**

- **A per-event checkbox, "Hide how many tickets are left"**
  (`events.hide_availability`, boolean NOT NULL DEFAULT false, migration
  0026). It is on the event form; the admin event page's plain-words
  summary says when it is on. Per event, not site-wide: a small
  sell-out show and a large free-flowing one want different things.
- **When on, the public sees no count anywhere, and nothing replaces
  it.** The home hero drops its "N left" label; the ticket list drops
  "N left" from every row; the closing-soon CTA reads "Register — closing
  soon"; C3 and C4 say the type is still available without a number.
- **"Sold out" stays public**, as do "Closed" and "Not yet", and the
  schema.org Offer availability enum (SoldOut / PreOrder / Discontinued,
  ADR-042) is unchanged: whether a type can be bought is not a count.
- **The count is stripped on the server.** The register page's
  `TicketOption.available` is `number | null`, and `null` when the event
  hides counts, so the number never reaches the client (not in the HTML,
  not in the RSC payload). Hiding it with CSS or a client flag would
  leave it one "view source" away.
- **The stepper always allows up to 10** (the per-order maximum) for a
  hidden event's type on sale; the server's atomic hold (Invariant 2) is
  the answer. The form's "over stock" check runs only when a count is
  known.
- **A refused multi-ticket order no longer marks the type sold out — for
  every event.** A `SoldOutError` for `requested > 1` now answers "Not
  that many tickets are left" and leaves the type choosable for a smaller
  quantity; only a refused single ticket proves none are left, so only
  `requested === 1` keeps "That ticket type sold out while you were
  choosing" and greys the row out (`soldOutTicketTypeId`). Before, asking
  for 6 when 4 remained wrongly showed the type as sold out; with hidden
  counts that would be routine.

**Consequences:**

- A determined buyer can still probe the count by asking for N tickets
  and watching which N are refused. That is inherent in selling a finite
  stock without showing it; each probe is a registration attempt under
  the existing order-create limit (20 per IP per 15 minutes), and a
  successful one holds real inventory and leaves an order to expire.
- Admins always see counts (event KPIs, ticket types, reports); the
  setting is about the public pages and buyer emails only.
- Existing events default to counts shown (the column defaults to
  false), so nothing changes until the organizer ticks the box.
- Any caching slice for the public pages or the home read model must
  carry the flag with the data it caches: a cached count served for an
  event that has since hidden it would leak what the organizer chose to
  hide.

**Rejected:** a site-wide switch (the organizer wants it per event); a
"Selling fast" hint in place of the count (it is scarcity again, and
vague claims invite distrust); hiding the count on the client only (the
number would still be in the page payload).
