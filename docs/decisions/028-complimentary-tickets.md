---
id: ADR-028
title: 'Complimentary tickets (B13): a ৳0 order born `issued`, inside fulfilment; seats, not sales'
date: 2026-09-23
status: accepted
area: Payments and orders
supersedes: []
extends: []
---

# ADR-028 — Complimentary tickets (B13): a ৳0 order born `issued`, inside fulfilment; seats, not sales

**Date:** 2026-09-23 · **Status:** Accepted

**Context:** The organizer gives free tickets (press, guests, sponsors).
They must take real seats and reach the door list, but bring in nothing,
and promo codes deliberately never make a ticket free (ADR-027). Design
B13: a sheet with ticket type, how many, one name, email and a required
reason ("kept in the audit trail, never shown to the guest"), and the note
"creates an order at ৳0.00 with a comp flag so revenue and attendance stay
honest". ADR-026 had already said reports would need a figure of their own.

**Decision:**

- **A comp is an order.** Same table, same tickets, same door list, same
  per-ticket cancel (which is the design's "cannot be undone — only
  cancelled ticket by ticket"). `orders.complimentary_reason` is the flag
  and the reason in one column, so they can never disagree. The price is
  the ticket type's row (Invariant 5), snapshotted like any order, and the
  whole subtotal is the discount, so `computeOrderTotals` gives ৳0 — no
  new money math.
- **It lives in `fulfilment.service.ts`** (`issueComplimentaryTickets`).
  That file is the only writer of `issued`, the only caller of
  `convertToSold` and the only creator of ticket rows (Invariant 4); a comp
  does all three, so it is a second entry point into the same module, not
  a copy. One transaction: `inventory.hold` (the same atomic UPDATE every
  order takes — sold out is `SoldOutError`, nothing written) →
  `convertToSold` → the order row inserted **at `issued`** → tickets → one
  `order.comp_issued` audit row (`∅ → issued`, reason and codes in the
  note). Retried whole on a reference or ticket-code collision. The C2
  email goes after commit through the existing `onTicketsIssued` hook.
- **The state machine gains an entry, not a transition.** Rows are born at
  a status by insert, as `createOrder` has always done at
  `pending_payment`; `assertOrderTransition` governs moves between
  existing statuses and is unchanged. A comp can only be `issued` or
  `cancelled` (CHECK `orders_complimentary_status`), so the expiry job and
  the verification queue can never see one.
- **The database backs it:** `orders_complimentary_free` (a comp's
  discount is its whole subtotal, it carries no trxID and no promo code),
  `orders_complimentary_status`, and `orders_phone_unless_comp` —
  `buyer_phone` is now nullable (the design asks no phone; there is no
  bKash sender to compare), but only a comp may lack one, because Find my
  order matches reference + phone.
- **No sales-window or registration-window check.** Comps are the
  organizer's call, before registration opens or after it closes; stock is
  the only limit. Same 1–10 per order as every order; more guests means
  issuing again. The sheet opens from the event's Ticket types tab (per-row
  "Issue comps" and a header button); not from B8 in this slice.
- **Comps are seats, not sales.** They are in the inventory counters
  (Tickets sold, Seats left, the public stock, the door list) and counted
  on their own — a fifth KPI "Complimentary" and a Comp column, shown only
  when an event has comps. They are out of every figure that describes
  buyers: verified-order counts, revenue orders, the funnel, the daily and
  cumulative series, discount given, order sizes, average ticket price,
  when people register. B9's revenue tile says "N paid orders · M comp".
  `orders.totalsByStatus` returns each status's `compCount` from the same
  query, so B9 and B12 subtract from one snapshot.
- **What the guest sees:** the C2 email and the A4 order page say
  "Complimentary tickets from <organizer>, issued on …" and never "paid";
  the reason is on B8 only.
- **Audit timestamps use `clock_timestamp()`** (migration `0016`). With
  `now()`, every row one transaction writes shares the transaction's start
  time, and `listEvents` (ordered by `created_at`) could return "order
  cancelled" before the "ticket cancelled" that caused it — found as a
  flaky integration test while building this slice; it predates it.

**Consequences:** Migrations `0014`–`0016`. `FulfilmentDeps` needs
`ticketTypes`. The B12 empty state ("No sales to report yet") stays until
the first _paid_ order, even if comps exist; the KPI row and ticket-type
table still show them. The summary CSV gains a trailing `complimentary`
column and the orders CSV a `complimentary` column.

**Revisit when:** comps need to be refused for an archived or finished
event (today nothing stops it; the guest would get a "You're in" email), a
double submit must be idempotent (two tabs issue two comps), or comps need
their own list/report beyond the order list.
