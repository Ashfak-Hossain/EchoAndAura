---
id: ADR-002
title: 24-hour inventory hold
date: 2026-08-21
status: superseded
area: Payments and orders
supersedes: []
extends: []
---

# ADR-002 — 24-hour inventory hold

**Date:** 2026-08-21 · **Status:** Superseded by [ADR-054](054-inventory-hold-20-minutes.md)

**Context:** Manual verification may take hours. A 10-minute cart hold would
expire before an admin ever sees the order.

**Decision:** Inventory is held for 24 hours on order submission, released on
rejection or expiry. Orders are capped at 10 tickets to limit the damage a
malicious or abandoned order can do to availability.

**Consequences:** A sold-out event may show unavailable while holds are pending.
Accepted because the alternative — overselling — is worse.
