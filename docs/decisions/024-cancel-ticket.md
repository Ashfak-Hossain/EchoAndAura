---
id: ADR-024
title: 'Cancel ticket: a fourth inventory primitive, order locks are NO KEY UPDATE, the last ticket cancels the order'
date: 2026-09-21
status: accepted
area: Payments and orders
supersedes: []
extends: []
---

# ADR-024 — Cancel ticket: a fourth inventory primitive, order locks are NO KEY UPDATE, the last ticket cancels the order

**Date:** 2026-09-21 · **Status:** Accepted

**Context:** "Admin can cancel a ticket, which releases inventory; money is
returned outside the system." Everything downstream already understood a
cancelled ticket (page and PDF stamp, rename refused, C2 re-send lists
live tickets, check-in list counts it); the write was missing.

**Decision:**

- **`inventory.releaseSold`** is the fourth conditional UPDATE in the
  repository (`quantity_sold = quantity_sold - $n WHERE quantity_sold >= $n`,
  backstopped by `ticket_types_sold_nonneg`). A cancelled ticket was paid
  for and converted to SOLD at approval; `release` works on the HELD counter
  and would free a seat some unpaid order still holds. Only
  `fulfilment.service.ts` calls it.
- **`fulfilmentService.cancelTicket`** is one transaction: lock the order
  (it must be `issued`) → lock the ticket (it must be on that order — a
  ticket id from another order is "not found", so a forged pair cannot
  cross orders) → conditional `issued → cancelled` on the ticket → only
  then `releaseSold(1)`, so a lost race releases nothing → audit row
  `ticket.cancelled` with the code, the attendee and a **required reason**
  (Invariant 6: "why" is answerable from the database). When it was the
  order's last live ticket the order follows, `issued → cancelled` (its one
  legal exit), with an `order.cancelled` row in the same transaction. A
  partially cancelled order stays `issued` and its revenue stays counted —
  money was received; the refund happens outside the app (the cancelled
  tile reads "returned outside").
- **Order row locks are `FOR NO KEY UPDATE`**, not `FOR UPDATE`. Review
  found a reproducible deadlock: a buyer's rename holds the ticket row and
  then inserts its `order_events` row, whose FK takes `KEY SHARE` on the
  order; an admin cancel holds the order `FOR UPDATE` and waits for the
  ticket. `NO KEY UPDATE` still excludes every other order writer (approve,
  reject, submit, cancel all take it) but does not conflict with an FK
  `KEY SHARE` — nobody updates an order's key. Belt and braces: rename now
  locks the order first too, the same order cancel and approve take. An
  integration test drives the exact interleaving and fails on `FOR UPDATE`.
- **No cancellation email.** C1–C4 are the designed messages; the admin
  is already talking to the buyer. A C2 re-send after a partial cancel
  lists and counts live tickets only, but keeps "Ticket 2 of 3" as the
  ticket's fixed place in the order (ADR-015), matching the PDF and page.
- **Out of scope:** "Cancel order" from `pending_payment` (not in the
  state machine), a time guard (cancelling after the event is harmless
  for inventory), bulk cancel / row selection.

**Consequences:** `TicketsRepository` gains `findByIdForUpdate`, `cancel`
(the one ticket status write, conditional) and `countIssuedByOrder`
(transaction-only: it must see the cancel that just happened). The B8 page
shows a per-ticket Cancel while the order is `issued` and a read-only note
once it is `cancelled`. The check-in list's "N cancelled tickets not
listed" is now reachable.

**Revisit when:** Raj wants buyers told (a C6 "ticket cancelled" email
after commit, like C3), or an un-cancel is requested (it is not: a
cancelled seat may already be resold — the buyer registers again).
