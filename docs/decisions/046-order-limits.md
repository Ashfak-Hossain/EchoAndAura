---
id: ADR-046
title: 'Limits on placing orders: two open per phone, twenty per network'
date: 2026-09-30
status: accepted
area: Security and auth
supersedes: []
extends: []
---

# ADR-046 — Limits on placing orders: two open per phone, twenty per network

**Date:** 2026-09-30 · **Status:** Accepted

**Context:** The Phase 7.6 security review found that registration had no
limit at all. Every order holds up to 10 seats for 24 hours, and only the
buyer (by paying) or the expiry job releases them. About ten scripted
requests could make a 100-seat event "sold out" for a day, and the phone
numbers on the form aren't verified, so they can be made up. The load
test (docs/LOAD-TEST.md) had shown the flow correct under a rush; this is
about who may take part in it.

**Decision:**

- **At most two open orders per phone number per event**
  (`MAX_OPEN_ORDERS_PER_BUYER`, `orders.service.ts`). "Open" means
  awaiting verification, or awaiting payment with a hold that hasn't
  lapsed (a lapsed hold stops counting even before the expiry job runs).
  Two leaves room for a second order for friends.
  - Checked **inside the order transaction, before any seat is held**,
    under a transaction-scoped advisory lock keyed on event + phone
    (`ordersRepository.lockBuyer`). Without it, parallel submits from one
    phone would each count zero open orders and all get through. The lock
    is per buyer, so nobody else waits on it.
  - A refusal holds nothing and writes nothing, and the buyer is told why
    and pointed at "Find my order".
- **At most 20 new orders per IP per 15 minutes**, in the register action,
  on the existing Redis limiter. Generous on purpose: Bangladeshi mobile
  carriers put many buyers behind one address (CGNAT). A limiter outage
  lets the order through; the per-phone cap still holds. Off for the e2e
  suite (`APP_ENV=test`), which registers from one address, like the
  sign-in limiter.
- **A Cloudflare rate-limiting rule** is the outer layer (Phase 7.6
  infra). The free plan can't match form posts alone, so it counts every
  request per address: see ADR-047.

**Consequences:**

- A hoarder now needs many phone numbers **and** many networks; each extra
  phone buys at most 20 seats (2 × 10) until the holds lapse.
- A buyer who abandoned two orders must wait for a hold to lapse (24 h) or
  pay one before ordering again. The message says so. The admin can't
  release an unpaid hold early; if that becomes a problem, that is the
  feature to add.
- Tests: unit (the cap, what counts as open, lock before count before
  hold), integration against Postgres (eight simultaneous submits from one
  phone → exactly two orders; other buyers unaffected; a lapsed hold frees
  the slot), e2e (the third order shows the message and keeps the form),
  and the load test's rush now sends a distinct address per buyer.

**Revisit when:** buyers verify their phone (an OTP makes the phone a real
identity, so the IP limit could loosen), or an event sells far more seats
than one person could plausibly want.
