---
id: ADR-053
title: 'Gate scanner "race both": the phone''s list answers ADMIT in 0.4 s; gates share check-ins'
date: 2026-10-04
status: accepted
area: Gate scanner
supersedes: []
extends: [ADR-034]
---

# ADR-053 — Gate scanner "race both": the phone's list answers ADMIT in 0.4 s; gates share check-ins

**Date:** 2026-10-04 · **Status:** Accepted · extends [ADR-034](034-gate-scanner-offline.md)

**Context:** Every scan waited for the server (ADR-030), up to 4 s on weak
venue signal before the phone fell back to its own list (ADR-034). The
person at the gate waited for the network. The phone already holds a
fresh, hashed list of every ticket, but between list downloads (60 s) it
knew nothing of other gates' check-ins.

**Decision (user-chosen "race both", 2026-10-04):**

- **The list first, the server too.** A camera or typed read is judged
  from the phone's list (one SHA-256, under 1 ms) while the request goes
  out. **Only a read the list would ADMIT races**: if the server answers
  within **0.4 s** its answer is shown; otherwise the phone shows ADMIT and
  checks behind them, and the camera takes the next person at once.
  **Refusals always wait for the server** (a stale list must never turn
  away a valid ticket); so do retries and name-search admits (the phone
  digits are checked only on the server).
- **The answer behind an early ADMIT:** admitted → nothing to show; no
  answer → an offline admit in the outbox that replaces the request
  (`supersedesScanId`, ADR-034 rules, so it is never counted twice);
  **refused → "STOP — server disagrees"**: full screen, flashing border,
  siren and vibration repeated until staff answer **Turned them away** or
  **Let them in anyway**.
- **The answer is recorded**, append-only, in `door_decisions` (scan id
  UNIQUE, so a retry is a no-op; UPDATE/DELETE revoked from the app role
  like `door_scans`). Only the scanning pass may answer, only a refusal,
  within 10 minutes. **Neither answer checks anyone in**: "let in anyway"
  records what happened at the gate. The admin Check-in page lists them
  under "The server disagreed".
- **Gates share check-ins:** the status ping, now every **5 s** (was 15),
  takes `?since=` and returns the event's check-ins after it (any gate or
  the admin, at most 500); the phone adds them to its list's marks, so a
  ticket used at Gate B is refused at Gate A within one ping — offline
  too. The next `since` overlaps the last by 10 s, so a check-in committed
  during a ping is never missed.
- While the phone itself reports no network (`navigator.onLine` false) the
  outbox timer does not try to send: a try then cannot reach the server,
  and marking scans "possibly sent" ended a local undo for nothing.

**Consequences:**

- With a list on the phone, the answer for a valid ticket never waits
  more than 0.4 s for the network.
- A copied ticket at two gates within the same ~5 s (a ping apart) can
  get both an early ADMIT; the second gate gets the disagree alert while
  the person is still there. Slice 3b (a Cloudflare relay) is to shrink
  that to well under a second and keep it working with the server down.
- Four gates' status pings: ~48 requests a minute, each a count and an
  indexed range read.
- **Production:** after the deploy that runs migration 0025, re-run
  `ops/db/app-role.sql` on the server (SERVER.md § 19 step 3): migrations
  run as the owner, and until then the app role could still rewrite
  `door_decisions` rows.

**Rejected:** racing refusals too (a stale list would turn away valid
tickets); showing the local answer always (two gates could admit one
ticket with no alert); a second check-in on "let in anyway" (one ticket,
one check-in — ADR-030); server push over SSE for the sharing (the
planned Cloudflare relay does it without the server, see slice 3b).
