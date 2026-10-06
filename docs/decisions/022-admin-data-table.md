---
id: ADR-022
title: 'Admin data table: TanStack Table in server-controlled mode; status totals'
date: 2026-09-21
status: accepted
area: Admin
supersedes: []
extends: []
---

# ADR-022 — Admin data table: TanStack Table in server-controlled mode; status totals

**Date:** 2026-09-21 · **Status:** Accepted

**Context:** Three hand-rolled admin tables (events, verification, orders)
with two more coming (check-in list, reports). Wanted: sortable columns,
column visibility, later row selection, and one component instead of
five. Also wanted on the orders page: totals by status.

**Decision:**

- **`@tanstack/react-table` 9.2.4**, admin only, through one client
  component `src/components/admin/data-table.tsx`. v9's feature-based API
  (`tableFeatures({ rowSortingFeature, columnVisibilityFeature })`,
  `useTable`, `createColumnHelper`) is what shipped; the `adminColumnHelper`
  wrapper pins the feature set so column files stay short.
- **Server-controlled, always.** The page fetches, filters, sorts and
  paginates; the table renders the rows it is given (`manualSorting`) and
  owns only column visibility. Nothing is ever filtered or paginated in
  the browser — the whole orders table would otherwise be shipped to it.
- **Sorting is a link.** `?sort=<column>:<asc|desc>` parsed against a
  per-page whitelist (`src/lib/table-sort.ts`, `parseSort`); the header
  renders a `<Link>` to the next state (`nextSort`: new column starts in
  its natural direction, same column flips). Works without JavaScript,
  the back button undoes it, the CSV export sees the same order. The
  repository maps the whitelisted name to a column (`sortOrder`) with an
  `id` tiebreak so pages stay stable. Unpaginated lists (events,
  verification) sort on the server in memory from the same URL param.
- **No functions across the server → client boundary.** Rows are plain
  serialised objects with their own `id` and pre-formatted labels; the
  table receives `sortBase: { pathname, query }` and builds hrefs itself.
  (The first cut passed `getRowId`/`sortHref` callbacks and crashed with
  "Functions cannot be passed directly to Client Components".)
- **Column visibility** is a per-viewer convenience in `localStorage`
  (`admin.table.<id>.columns`), read through `useSyncExternalStore` so
  the server render and the first client render agree and the React
  compiler's no-setState-in-effect rule holds. The "Columns" menu is the
  shadcn dropdown; Base UI requires its `GroupLabel` inside a `Group`.
- **Phone layouts keep their card lists**; the DataTable is `hidden
lg:flex`.
- **Status totals** (`orders/status-totals.tsx`): one `GROUP BY status`
  query (`totalsByStatus`) for the current event/date/term filter with
  `status` ignored; tiles double as the status filter (active tile links
  back to "all"). **Revenue = paid + issued only**; pending sums are
  labelled "held", rejected/expired "not taken"; cancelled is a count,
  never "refunded" — refunds happen outside the app. `summariseTotals`
  is unit-tested for exactly that rule.

**Also fixed on the way:** the admin dashboard ran one ticket-types
query per published event (`listForEvent` in a `Promise.all`); with the
dev database at ~260 published test events every sign-in landed on a
page doing 260 queries, which is what had been making the e2e sign-ins
time out. Now `listForEvents` — one `IN` query. And the e2e suite runs
on its own database (`tests/e2e/prepare-db.ts`: create, migrate,
truncate, seed the admin, refuse any name not ending in `_e2e`) instead of
growing the dev database run after run.

**Consequences:** one dependency; `columns.tsx` per table; the events
and verification pages are on the same component. Row selection and bulk
actions arrive with the check-in list.

**Revisit when:** a table needs client-side interactivity beyond
visibility (inline edit, drag), or a list grows past what one server
query per page handles.
