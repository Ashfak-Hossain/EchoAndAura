# Architecture Decision Records

Short entries. Written when a choice is non-obvious or would be questioned
later. Never deleted — superseded entries are marked, not removed.

---

## ADR-001 — Manual bKash verification instead of API integration

**Date:** 2026-08-21 · **Status:** Accepted

**Context:** The client does not have a bKash merchant account and cannot obtain
one before the launch date.

**Decision:** Buyers pay manually and submit a transaction ID. An admin verifies
against the bKash statement and approves, which triggers automatic ticket issue.

**Consequences:** No payment API, tokens, callbacks, or reconciliation job.
Introduces manual admin workload (~1 hour/day at 1,000 attendees) and requires a
24-hour inventory hold rather than a 10-minute cart hold. Transaction ID
uniqueness must be enforced at the database level to prevent reuse.

**Revisit when:** a merchant account is obtained — the state machine is designed
so an API path can be added without changing the fulfilment logic.

---

## ADR-002 — 24-hour inventory hold

**Date:** 2026-08-21 · **Status:** Accepted

**Context:** Manual verification may take hours. A 10-minute cart hold would
expire before an admin ever sees the order.

**Decision:** Inventory is held for 24 hours on order submission, released on
rejection or expiry. Orders are capped at 10 tickets to limit the damage a
malicious or abandoned order can do to availability.

**Consequences:** A sold-out event may show unavailable while holds are pending.
Accepted because the alternative — overselling — is worse.
