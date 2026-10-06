---
id: ADR-014
title: 'Fulfilment: approve is one transaction to `issued`, email hooks after commit, rejection reasons on the order'
date: 2026-09-19
status: accepted
area: Payments and orders
supersedes: []
extends: []
---

# ADR-014 — Fulfilment: approve is one transaction to `issued`, email hooks after commit, rejection reasons on the order

**Date:** 2026-09-19 · **Status:** Accepted

**Context:** Invariant 4 names `fulfilment.service.ts` as the only code
that marks an order paid and issues tickets. The design (B8) says approving
"issues N tickets and emails them immediately", rejecting requires a reason
from a fixed list the buyer then reads, and two admin tabs may act on the
same order.

**Decision:**

- **Approve = `pending_verification → paid → issued` in ONE transaction**:
  lock the order (`SELECT … FOR UPDATE`) → `paid` + audit row →
  `inventory.convertToSold` (its one and only call site) → one ticket row per
  attendee name captured at registration → `issued` + audit row. `paid`
  stays in the state machine as the legal intermediate but never persists
  on its own in normal operation. A ticket-code UNIQUE collision rolls the
  whole transaction back and retries with fresh codes (×3).
- **The email is an after-commit port.** `onTicketsIssued(orderId)` is
  injected; the container passes a log-only implementation until the email
  slice replaces it with a queue producer. Its failure is logged, never
  surfaced — the tickets are real and the email can be re-sent (Invariant
  7: nothing network inside the transaction).
- **Reject requires a reason from a fixed list** (`rejection-reasons.ts`;
  labels are the buyer-facing wording) and an optional note shown word for
  word. Both are stored on the order (`rejection_reason`,
  `rejection_note`, migration `0005`) _and_ in the audit note; inventory is
  released in the same transaction, after the status flip, so a double
  reject can never double-release.
- **Approve carries the trxID the admin verified.** A buyer may edit the
  trxID while `pending_verification` (ADR-013). Approving by order id alone
  would issue tickets against a swapped id and free the verified one for a
  second order — one payment, two orders. The action binds the trxID the
  page showed; the service compares it under the row lock and refuses with
  `TrxIdChangedError` so the admin looks again. Found in review.
- **Concurrency is settled by the row lock and the conditional UPDATE**: of
  two simultaneous approves exactly one issues tickets; approve × reject
  yields exactly one of {tickets, release}; approve × buyer-edit never
  issues against an unverified id. All three proven against Postgres.
- An order whose attendee names no longer match its quantity is refused
  (`AttendeeNamesMismatchError`), never padded — that is corruption.
- **Ticket codes** are `TKT-` + 8 unambiguous characters — the code is the
  access key of the web ticket page, so it is longer than an order
  reference.
- **The actor** on admin audit rows is the admin's email from the session,
  passed in by the action (services never touch auth, ADR-004).
- The design's "trxID seen before" chip is not built: the UNIQUE index
  already makes two orders with one trxID impossible.

**Consequences:** `paid` orders should never be observed; if one is, a
transaction failed between the two transitions and the row lock protected
it — investigate, do not "repair" by hand. Cancelling a ticket (Phase 6)
must release exactly one seat via the same inventory primitive.

**Revisit when:** issuing needs to be deferred from approval (e.g. a
separate "generate tickets" job), or when partial approval (fewer tickets
than paid for) is ever requested — neither is planned.
