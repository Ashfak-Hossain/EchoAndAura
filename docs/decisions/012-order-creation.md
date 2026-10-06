---
id: ADR-012
title: 'Order creation: one transaction, prices from the row, uuid URLs, attendee names on the order'
date: 2026-09-19
status: accepted
area: Payments and orders
supersedes: []
extends: []
---

# ADR-012 — Order creation: one transaction, prices from the row, uuid URLs, attendee names on the order

**Date:** 2026-09-19 · **Status:** Accepted

**Context:** The A3 form is where money starts. It must never oversell
(Invariant 2), never trust a client price (5), always leave an audit row
(6), never do network work inside a transaction (7), and must keep a
buyer's input on every error. The order page shows the buyer's email and
phone.

**Decision:**

- **`ordersService.createOrder` reads first, then runs exactly three
  statements in one transaction**: `inventory.hold` → insert `orders`
  (`pending_payment`, `hold_expires_at = now + 24 h`) → insert
  `order_events` (`buyer / order.created / null → pending_payment`). The
  event window (`eventPhase`), ticket-type ownership and sales window
  (`ticketTypeSaleState`) and the price are all read _before_ the
  transaction, so the `ticket_types` row lock lasts microseconds. Sold-out
  is thrown **inside** the callback (`SoldOutError`) so the rollback is
  automatic and nothing is written. `runInTransaction` is injected — the
  service never imports the client, and unit tests fake it with a snapshot
  that restores on throw.
- **Money comes from `ticket_types.price_paisa` via `computeOrderTotals`**
  (`src/server/lib/pricing.ts`), the only place totals are computed. The Zod
  schema strips unknown keys, so a `totalPaisa` in the body is simply gone.
  Discount is 0 until promo codes (Phase 5); the cap-at-subtotal rule is
  already in place.
- **Orders start as `pending_payment`.** The state machine
  (`order-status.ts`, from CLAUDE.md) and the A4 design ("Awaiting payment"
  → "Checking payment") agree; CLAUDE.md's payment-model step 2 was
  reworded to match.
- **Expiry policy.** The expiry job selects
  `status = 'pending_payment' AND hold_expires_at < now()` **only**. A
  `pending_verification` order has a trxID, so real money may have left
  the buyer's account; it is resolved by Approve/Reject, never by the
  clock. `pending_verification → expired` stays legal in the table for an
  admin acting by hand on a stale, never-verified claim.
- **Order page URL is `/orders/<uuid>`, `noindex`, `force-dynamic`.** The
  reference `EA-XXXXXX` (unambiguous alphabet, ~887 M values, UNIQUE + one
  retry loop on collision) is for the bKash reference field and phone
  calls, not for access.
- **Attendee names are a `text[]` column on `orders`** (migration 0003).
  Tickets are created at fulfilment; the names captured on A3 wait on the
  order and are copied onto ticket rows then.
- **Phone is stored E.164** (`+8801XXXXXXXXX`), entered as ten digits after
  a fixed `+880`. The bKash statement shows the sender's number, so this is
  what the admin will compare against.
- `BKASH_RECEIVE_NUMBER` / `ORGANIZER_CONTACT_EMAIL` are env for now;
  Settings (B14) takes them over in Phase 6.

**Consequences:** The integration suite proves a 12-way race for the last
ticket yields one order, and the e2e suite proves it through two browser
contexts. Registration has no promo field yet (design shows one).

**Revisit when:** promo codes land (discount input to `computeOrderTotals`,
promo row read before the tx), or if orders ever need more than one ticket
type (the schema's one-type-per-order rule is load-bearing here).
