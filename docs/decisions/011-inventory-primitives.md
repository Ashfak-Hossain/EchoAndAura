---
id: ADR-011
title: 'Inventory primitives: three conditional UPDATEs with an injectable executor'
date: 2026-09-19
status: accepted
area: Payments and orders
supersedes: []
extends: []
---

# ADR-011 — Inventory primitives: three conditional UPDATEs with an injectable executor

**Date:** 2026-09-19 · **Status:** Accepted

**Context:** Invariant 2 says inventory is held with one conditional atomic
UPDATE, never read-then-write. Order creation (Phase 3) must hold inventory
and insert the order in the same transaction; fulfilment (Phase 4) must
convert held → sold and mark the order paid together; rejection and expiry
must release. The concurrency test has imported
`reserveTicketInventory(id, qty)` from the service module since Phase 0.

**Decision:**

- `src/server/repositories/inventory.repository.ts` is the **only** writer
  of `quantity_reserved` / `quantity_sold`. Three methods, each a single
  `UPDATE … WHERE <condition on current values> RETURNING id`: `reserve`
  (available ≥ qty), `release` (held ≥ qty), `convertToSold` (held ≥ qty).
  The database evaluates the condition under the row lock, so no two callers
  can both pass a check only one of them satisfies.
- **Sold-out is a value, corruption is an exception.** `reserve` resolves
  `false` when stock is short — an expected outcome the page must explain.
  `release`/`convertToSold` matching no row means something is already
  wrong (double release, double approve) and throws `InventoryStateError`;
  the `ticket_types_*` CHECK constraints backstop both, and a `23514` is
  mapped to the same error.
- **Every method takes an optional executor** (`DbExecutor` =
  pool | Drizzle transaction, `src/db/executor.ts`). Repositories never open
  transactions; the service that owns the business operation does, and
  passes `tx` down. The integration test proves a reserve inside a
  transaction rolls back with it.
- `createInventoryService(repo)` validates the quantity rule (integer 1–10,
  `src/server/lib/order-rules.ts`, shared with the Zod boundary) and nothing
  else. Sales windows, event status and prices are order-creation concerns.
- The historic `reserveTicketInventory` export is kept so the concurrency
  test never needs editing. It binds to the real repository with a **lazy
  dynamic import**, because the repository imports `db/client`, which needs
  `DATABASE_URL` at import time — a static import would drag that into every
  unit test loading the service.
- The vitest **integration project sets `DATABASE_URL = TEST_DATABASE_URL`**.
  The test seeds rows through its own client on `TEST_DATABASE_URL` while
  the code under test uses the shared `db` on `DATABASE_URL`; before this
  they were two different databases and the row under test was invisible to
  the service. This also guarantees the integration suite never writes to
  the dev database.

**Consequences:** CI now runs `pnpm db:migrate && pnpm test:integration:db`
(the Postgres-only subset) after `pnpm verify`; the storage integration test
stays local-only until MinIO is added to CI. `ticket-types.repository.ts`
continues to never touch the two counters.

**Revisit when:** a waitlist needs "reserve when released" semantics
(a NOTIFY on release, or a queue), or when per-order holds need to be
individually addressable (a `holds` table) rather than a counter.
