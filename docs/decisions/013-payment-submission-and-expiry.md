---
id: ADR-013
title: Payment submission and the expiry worker
date: 2026-09-19
status: accepted
area: Payments and orders
supersedes: []
extends: []
---

# ADR-013 — Payment submission and the expiry worker

**Date:** 2026-09-19 · **Status:** Accepted

**Context:** Phase 3's exit is "an order holds inventory and expires
correctly". The buyer must be able to report a bKash payment, correct a
mistyped trxID, and never pay for the same order twice with one
transaction; lapsed holds must go back on sale without ever being released
twice.

**Decision:**

- **One status-writing repository method.** `ordersRepository.transition(id,
{ from[], to, patch })` is the conditional
  `UPDATE … WHERE id = $id AND status = ANY($from) RETURNING *`. Null means
  the row moved; callers throw `OrderStatusConflictError` and the page
  re-renders in the real state. Fulfilment, reject and cancel (Phase 4/6)
  reuse it — there is no other way to write `orders.status`.
- **Submission is allowed from `pending_payment` and `pending_verification`.**
  The first moves the status (`payment.submitted`); a later one only
  replaces the trxID/number (`payment.updated`), matching the design's
  "Edit transaction ID". The UNIQUE index on `bkash_trx_id` is the only
  uniqueness check (Invariant 3); it surfaces as `TrxIdAlreadyUsedError`
  and the audit row rolls back with the refused write. Uniqueness is a
  banner on the page, not a field error (design A4).
- **The expiry job is the sole authority on expiry.** It selects
  `status = 'pending_payment' AND hold_expires_at < now()` and, per order in
  one transaction: flip the status conditionally → _only then_ release the
  hold → audit row (`system / order.expired`). A submission racing the job
  is settled by whichever conditional UPDATE lands first; a second run or a
  second worker can never double-release because the flip fails. The A4
  page shows a lapsed hold as expired before the job runs, so nobody is
  invited to pay for tickets about to go back on sale.
- **The worker owns the schedule.** `src/worker.ts` upserts a BullMQ job
  scheduler (`expire-holds`, every 60 s) on boot — idempotent across
  restarts and replicas — and processes it with a one-line call into the
  tested service. The Next app does not connect to Redis in Phase 3.
  `pnpm jobs:expire-holds` runs the same service once for ops.
- **pino** (`src/server/lib/logger.ts`) is the logger for services and the
  worker; pretty locally, JSON in production. Order ids are logged, never
  trxIDs or buyer contact details.

- **Defence in depth on the trxID:** the service upper-cases and trims
  whatever it is given, and migration `0004` adds
  `CHECK (bkash_trx_id = upper(btrim(bkash_trx_id)))`, so no code path can
  store a value the UNIQUE index would not compare correctly. The audit
  row's from-status is read under `SELECT … FOR UPDATE` so two tabs
  submitting at once cannot make it lie.
- **A failing order never blocks expiry:** each lapsed hold runs in its own
  transaction inside a try/catch; failures are logged, counted, and fail
  the BullMQ job, while the rest of the batch still expires.

**Consequences:** A `pending_verification` order never expires
automatically; if the organizer never acts, it holds inventory until they
Approve or Reject (B7/B8, Phase 4). The "Checking payment" page refreshes
itself every 60 s (`router.refresh()`), paused while the edit form is open
so a refresh never wipes typing. The worker needs `NODE_ENV=production` on
the VPS: `pino-pretty` is a dev dependency and is only loaded outside
production.

**Revisit when:** a waitlist wants to be told about releases (emit an event
from the expiry tx), or when the verification queue needs a "stale claims"
view for orders sitting in `pending_verification` past their hold.
