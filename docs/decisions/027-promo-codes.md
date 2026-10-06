---
id: ADR-027
title: 'Promo codes (B10): per-ticket discount, priced only on the server, refused rather than dropped'
date: 2026-09-23
status: accepted
area: Payments and orders
supersedes: []
extends: []
---

# ADR-027 — Promo codes (B10): per-ticket discount, priced only on the server, refused rather than dropped

**Date:** 2026-09-23 · **Status:** Accepted

**Context:** The schema carried `promo_codes`, `promo_code_ticket_types`,
`orders.promo_code_id` and `orders.discount_paisa` since Phase 0, but
nothing read or wrote a code. Business rule: percentage or fixed, unlimited
uses, restrictable to ticket types. Design: B10 (table + create sheet) and
A3 (an optional code field with Apply).

**Decision:**

- **The discount is per ticket.** A percentage takes `floor(price × pct /
100)` off each ticket (`percentOfPaisa` in `money.ts` — floor, so a
  discount is never a rounding paisa more than offered); a fixed amount
  takes `min(value, price)` off each ticket, so no ticket goes below ৳0.
  The order discount is that × quantity, still capped by
  `computeOrderTotals`. Matches the design's preview "A General ticket
  becomes ৳1,020.00". The rules live in pure `lib/promo.ts`, shared by the
  server and the A3 live preview.
- **Invariant 5 holds:** the client sends a code string, never an amount.
  `createOrder` resolves the code from the database, checks it is active
  and covers the chosen ticket type, and prices the order from the
  `ticket_types` and `promo_codes` rows. The order snapshots `discount_paisa`
  and `promo_code_id`; the `order.created` audit row names the code and
  the discount (Invariant 6).
- **One judgement, `judgePromo`, for Apply and submit** — they can never
  disagree. A code that does not apply is refused, not dropped:
  `PromoCodeNotValidError` is thrown before the hold, so a bad code never
  holds stock. A code typed but never applied is still sent and checked on
  submit. Unknown, switched-off and other-event codes all read "not valid
  for this event", so probing cannot tell them apart.
- **A code never makes a ticket free.** A ৳0 order cannot be paid by bKash
  and would sit held until it expired; free tickets are complimentary
  tickets (B13). Percentages are 1–99 (form + CHECK), and a fixed amount
  that would take a ticket's whole price is refused for that type
  ('makes_ticket_free'); the admin preview says so.
- **Every code check is throttled** — Apply _and_ a submit that carries a
  code share one 20/min per-IP budget. Without that, submitting against a
  sold-out type was an unthrottled way to test codes (found in review).
  Both actions validate their arguments with Zod and catch outages so the
  buyer's form survives. Submit prices again whatever Apply said.
- **Codes are global, and the scope is explicit.** No restriction rows =
  every ticket type in every event, so the form asks "Any ticket type" vs
  "Only these" and refuses "Only these" with nothing ticked — unticking the
  last type can never widen a code by accident. For the same reason the
  restriction FK is `ON DELETE RESTRICT`; the ticket-type delete tells the
  admin to take the type off the code first (switching the code off is not
  enough — the restriction row still exists).
- **The code text is fixed** after creation; type, value, restrictions and
  active can change and only affect new orders. A code any order used can
  be switched off but never deleted (`orders.promo_code_id` FK).
- **"Uses" = verified orders** (paid + issued, the B9/B12 vocabulary) with
  "+N pending" beside it, and "Discount given" over verified orders.
- Migrations `0012`/`0013`: `promo_codes_code_format` (the exact code
  pattern, so no row can exist that a normalised lookup would miss),
  `promo_codes_percentage_range` 1–99, `promo_codes_value_positive`, index
  `orders_promo_code_id_idx`, the FK change above, and
  **`orders_totals_consistent`** — `subtotal = unit × quantity`, `discount ≤
subtotal`, `total = subtotal − discount` — the database backstop for
  Invariant 5 now that discounts are live. One new UI primitive: shadcn
  `switch` (Base UI).

**Consequences:** A code changed or switched off between Apply and submit
prices the order by the rule at submit time (the rule is read just before
the order transaction). The buyer still sees the amount due on the order
page before any money is sent — nobody pays a price they were not shown.
Promo edits are logged with the actor but write no `order_events` row
(they are not order state changes). The B12 report's "Discounts of ৳X"
line now has data.

**Revisit when:** a code needs a usage cap or an expiry date (a counter
becomes an inventory-style race and needs the conditional-UPDATE pattern),
or codes need to be scoped per event rather than per ticket type.
