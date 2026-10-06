---
id: ADR-059
title: 'Gate scanner pre-doors test: six checks on each phone, never a lock'
date: 2026-10-05
status: accepted
area: Gate scanner
supersedes: []
extends: []
---

# ADR-059 — Gate scanner pre-doors test: six checks on each phone, never a lock

**Date:** 2026-10-05 · **Status:** Accepted · completes the scanner redesign (slice 4 of 4, after ADR-052, ADR-053 and ADR-058)

**Context:** The ways a gate phone fails all show up in front of the queue:
camera blocked, a slow reader, a stale ticket list, silent mode, a dying
battery, no offline copy. Each can be checked before doors open, on the
phone itself. Slice 2 already measures the reading speed for this.

**Decision:**

- **"Run pre-doors test"** on the start screen opens a full-screen panel
  and starts the camera behind it. The open panel stops any admit, so a code
  in view waits until the test closes.
- **Six rows**, each ok / warn / fail. The rules live in one pure function,
  `selfTestRows` (`src/app/door/self-test.ts`):
  - **Camera:** on, back camera, refocusing. The front camera warns.
  - **Reading speed:** the running average from ADR-052. Under 150 ms is
    ok, up to 400 ms warns ("close other apps"), slower fails.
  - **Ticket list:** built in the last 5 minutes (it refreshes every
    minute online), else warns. No list fails.
  - **Sound and vibration:** staff tap Test, then **Heard it**. Playing the
    sound alone does not count, because only a person can confirm they
    heard it.
  - **Battery:** charging or at least 50 % is ok, below that warns, below
    20 % fails. Shown only where the browser reports it (Android Chrome);
    iPhone Safari does not, so the row is left out there.
  - **Works offline:** the page and decoders saved (`keepPageOffline` now
    reports its outcome) and a list on the phone.
- **READY** when every row is ok. Otherwise the panel shows "N checks left"
  and a **Start scanning anyway** link. The test advises and never locks the
  gate: the people at the door decide.
- Nothing is sent to the server. The result lives on the phone, for the
  person holding it.

**Consequences:**

- `tests/e2e/door-camera.spec.ts` runs the test on the fake camera. The rows
  turn ok, the code in view is not admitted while the panel is open, and
  Heard it brings READY.
- RUNBOOK "Before doors open" gains: every gate phone shows READY.

**Rejected:** blocking Start until READY (a phone with no battery reading or
a slow camera must still be usable); playing a test sound without asking
(it proves nothing about volume or silent mode); reporting results to the
admin gate-pass card (useful later, not needed to run a gate).
