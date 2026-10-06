---
id: ADR-021
title: 'Orders list (B9): normalised search, URL state, CSV as a route handler'
date: 2026-09-21
status: accepted
area: Admin
supersedes: []
extends: []
---

# ADR-021 — Orders list (B9): normalised search, URL state, CSV as a route handler

**Date:** 2026-09-21 · **Status:** Accepted

**Context:** After verification, an order had no page to be found from.
Raj needs "which order was this TrxID?", "did this buyer's email bounce?",
"how many orders did event X take?", and a spreadsheet of the answer.

**Decision:**

- **The search term is normalised exactly like the stored data, then
  matched by equality.** `normaliseSearchTerm` (`src/lib/validation/
orders-search.ts`) runs the same rules registration used: reference →
  `EA-` + upper, trxID → upper, phone → E.164 via `bdMobile`, email →
  lower. Every interpretation that parses is kept and the repository ORs
  them (`reference = … OR bkash_trx_id = … OR buyer_phone = … OR
buyer_email ILIKE %…%`). Identifiers hit indexes; only the email is a
  substring scan (LIKE wildcards escaped). No trigram or full-text search:
  a single organizer's table is thousands of rows and the identifiers are
  exact by nature. The service names which interpretation each row
  satisfied (`matchedField`) so the UI can tint that cell.
- **The URL is the state.** A plain GET form; `q`, `status`, `event`,
  `from`, `to`, `page` are parsed by a lenient schema (bad values fall
  back to "no filter", never a 400). Back button, bookmarks and the CSV
  link all carry the same query. Date bounds are Dhaka calendar days,
  `to` inclusive. Page size 25; an out-of-range page clamps to the last.
- **CSV export is a route handler** (`/admin/orders/export.csv`), not a
  server action: a download needs headers and a filename. It calls
  `requireAdmin()` itself (ADR-017's rule), applies the same filter with
  a 10 000-row cap, and returns RFC 4180 CSV with a UTF-8 BOM (Excel +
  Bangla) and CRLF; cells starting with `= + - @` are prefixed with `'`
  so a buyer's name can never become a spreadsheet formula. Money is a
  plain decimal column (`formatDecimalBDT`) so it sums.
- Indexes added on `orders.buyer_email`, `buyer_phone`, `created_at`
  (migration 0010); `reference` and `bkash_trx_id` were already unique.

**Consequences:** `bdMobile` is now exported from `validation/orders.ts`.
The verification queue keeps its own unbounded query. `toCsv` is shared
with the check-in export (next slice). The dashboard's "recent orders"
(B3) can reuse `searchOrders` with an empty filter.

**Revisit when:** a second organizer or > ~100k orders make the email
scan slow (then a trigram index), or Raj asks for saved views.
