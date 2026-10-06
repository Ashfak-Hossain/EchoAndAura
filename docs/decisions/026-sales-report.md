---
id: ADR-026
title: "Sales report (B12): read-only aggregates, the audit trail is the clock, B9's money vocabulary reused"
date: 2026-09-22
status: accepted
area: Admin
supersedes: []
extends: []
---

# ADR-026 — Sales report (B12): read-only aggregates, the audit trail is the clock, B9's money vocabulary reused

**Date:** 2026-09-22 · **Status:** Accepted

**Context:** Orders (B9) and the check-in list (B11) answer questions one
row at a time; "how is this event selling" needed one screen. The B12
artboard gives a skeleton (event selector, four StatCards, daily bars,
sold-per-type table, export); the user asked for a fuller report
dashboard. Every figure had to be derivable truthfully from what the app
already stores — no new tables, no estimates.

**Decision:**

- **A `reports.repository` of aggregate reads only** (one statement each,
  scoped to an event), a `reports.service` that runs them in parallel and
  assembles one typed `SalesReport`, and a pure `lib/sales-report.ts` for
  the arithmetic (windows, zero-filled series, deltas, funnel, histograms)
  so it is unit-tested without a database. Nothing is cached: the report
  is live on every load. `PrintButton` moved to `components/admin`.
- **One definition of revenue.** `REVENUE_STATUSES` (`paid`, `issued`)
  now lives in `lib/order-status.ts` beside the state machine and is
  shared by B9's status strip and B12, so the two screens can never
  disagree. Pending money is "waiting", rejected/expired "never received",
  a cancelled order "returned outside the app" — never "refunded". A
  partially cancelled order stays counted (ADR-024).
- **Seats come from the inventory counters** (`quantity_sold` /
  `quantity_reserved`), the same numbers the public stock shows — net of
  cancellations — not from a count over orders. The daily and cumulative
  series, the period deltas and the "tickets per order" figures are the
  **gross verified quantity** (`SUM(orders.quantity)` — a partially
  cancelled order keeps its quantity, ADR-024), so they are labelled
  "verified", never "sold", and the cumulative caption quotes the net
  seat count beside them whenever the two differ.
- **The audit trail is the clock.** The day of a sale is the Dhaka date of
  the order's `payment.approved` row; time-to-pay is `order.created →
payment.submitted`, time-to-verify is `payment.submitted →
payment.approved` (medians via `percentile_cont`). No `paid_at` column:
  Invariant 6 already records those moments, the money path in
  `fulfilment.service.ts` stays untouched, and there is no migration.
  Dhaka buckets are computed in SQL (`AT TIME ZONE 'Asia/Dhaka'`, a
  literal — a bound parameter would not match between SELECT and GROUP BY).
- **"When people register" uses order creation** (every status): that is
  when buyers act; money figures use verified orders only.
- **Ranges** are 14/30/90 days ending today or "all" from registration
  opening (or the first sale, whichever is earlier). A delta compares the
  window with the same number of days before it and is never shown for
  "all". The overview lists the newest 12 events (the CSV has them all).
- **Not claimed:** complimentary tickets and discounts (Phase 5 — the
  discount line renders only when the sum is > 0), refund amounts (the
  app does not know them), any projection of final sales.

- **Charts are Recharts via shadcn's `Chart`** (B12.1, after the plain-div
  first cut): SVG (prints, scales, keeps the `sr-only` tables), themed
  hover tooltips, and it sits on the stack we already have — not Chart.js
  (canvas, imperative, its own theming). `recharts` is pinned exactly;
  `components/ui/chart.tsx` is CLI-generated and never hand-edited. The
  chart components only draw; every figure is still computed on the server.

**Consequences:** ~8 aggregate queries per page load over one event's
orders — trivial at this scale, and the existing `event_id` / `order_id`
indexes cover them. The dashboard's placeholder "Orders today / Revenue
today" can be wired to `reportsRepository.dailySales` in a follow-up.

**Revisit when:** an event lives long enough that "all time" bars get
dense (weekly buckets), B13 comps land (a fifth KPI and a line in the
table), or Raj wants the report emailed nightly (a queue job, not a page).
