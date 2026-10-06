---
id: ADR-054
title: 'Inventory hold: 20 minutes on a visible clock, a 2-minute grace'
date: 2026-10-04
status: accepted
area: Payments and orders
supersedes: [ADR-002]
extends: []
---

# ADR-054 — Inventory hold: 20 minutes on a visible clock, a 2-minute grace

**Date:** 2026-10-04 · **Status:** Accepted · supersedes [ADR-002](002-24-hour-inventory-hold.md)

**Context:** ADR-002 chose 24 hours when a submitted order could still
expire, so the hold had to outlast the admin's verification. ADR-012 then
made `pending_verification` never expire: a person decides. The hold now
only has to cover sending the money and pasting the trxID — minutes, not a
day. A long hold lets a few people sit on seats (up to 10 each) that
others would buy, and a sold-out event shows unavailable for a day after
an abandoned checkout.

**Decision (user-chosen, 2026-10-04):**

- **One pure module, `src/server/lib/hold.ts`:** `HOLD_MINUTES = 20`,
  `HOLD_GRACE_MINUTES = 2`, `holdEndsAt`, `holdCutoff` (+2 min),
  `lapsedBefore`, `holdLapsed(order, at)` (`pending_payment` and
  `at >= cutoff`). The service, the expiry job, the order page, the
  account page and the public copy all read it, so the clock the buyer
  sees and the cutoff the server enforces cannot drift apart.
- **A live mm:ss countdown on the order page,** offset by the server's
  clock (a phone a few minutes out still counts down to the right moment),
  refreshing the page at the cutoff.
- **A silent 2-minute grace:** a trxID is still accepted for 2 minutes after
  the clock reaches zero (a slow last tap, a stale page). Never shown.
- **The cutoff is enforced in `submitPayment` under the row lock:** past
  it, `HoldLapsedError` — the order page says the hold expired before the
  transaction ID was saved. The order page (`frameOf`) and the account page
  show "expired" by the same rule even before the job has run.
- **Expiry on its own queue `holds` with its own worker** (concurrency 1,
  no limiter). On the shared `orders` queue it waited behind emails (a
  5/s limiter) — after a rush, the very C4 emails its own expiries queue —
  and seats came back late. The worker removes the old scheduler from the
  `orders` queue on boot.
- **Each run loops batches of 200, up to 10 per run,** skipping ids that
  failed, until a short batch. Audit note `20-minute hold lapsed; N
released`.
- **Admin:** the verification queue's hold column and sort are gone (only
  `pending_verification` is listed, and it never expires); the admin order
  page shows the hold only for `pending_payment`. The dashboard tile is
  "Unpaid holds": every open hold not yet lapsed.
- **The "hold expired" email (C4) is kept.**
- Once a trxID is submitted nothing expires (ADR-012, unchanged).

**Consequences:**

- Abandoned checkouts free their seats about 20–23 minutes after they
  were placed (20 + 2 grace + up to a minute for the job).
- A rush's abandoned orders lapse together, about 22 minutes after the
  on-sale: a second wave of seats and a second scramble.
- A buyer who paid but missed the cutoff cannot paste the trxID; they go to
  the organizer by hand, as the FAQ says.
- Open orders placed before the deploy keep their stored 24-hour
  `hold_expires_at`; nothing rewrites them. Their order page shows the
  clock in hours (h:mm:ss) and its sentence names no duration; they are
  missing from the "Unpaid holds" dashboard tile (a 20-minute window) until
  they lapse. Best deployed when no order is awaiting payment.
- The cutoff is one rule everywhere: lapsed AT `holdExpiresAt + 2 min`
  (`holdLapsed`, and `hold_expires_at <= lapsedBefore(at)` in the expiry
  query), so the moment a late trxID is refused the job may release.
- A worker outage now matters within minutes: seats stay held and C4 does
  not go out. With expiry on its own worker, its heartbeat no longer proves
  the email worker runs, so a `worker.ping` job on the orders queue writes
  a second key every minute (`ORDERS_WORKER_HEARTBEAT_KEY`); `/api/health`
  needs both fresh (3 minutes, ADR-040). The ping waits behind the emails
  like any job, so a swamped email queue shows too.
- The C1 dispatcher guard skips a C1 still queued past the 20-minute
  deadline (after a rush); the content is on the order page anyway.

**Rejected:** a strict cutoff at zero (punishes a last-second tap and
skewed phone clocks); a 5-minute grace (a quarter of the hold again, seats
locked longer for little gain); a deadline for `pending_verification`
(contradicts ADR-012: money may already have moved); dropping C4 (the
buyer would never learn their seats were released).
