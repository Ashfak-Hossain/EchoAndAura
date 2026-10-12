---
id: ADR-070
title: better-auth's rate limiter counts in Redis, shared by every web instance
date: 2026-10-12
status: accepted
area: Security and auth
supersedes: []
extends: [ADR-019]
---

# ADR-070 — better-auth's rate limiter counts in Redis, shared by every web instance

**Context:** Phase 9.6 plans two web replicas. better-auth's own rate limiter
(ADR-019) kept its counts in process memory, so each replica would allow its
own `max` and two replicas would double every limit. That limiter guards the
auth routes still open over HTTP: email-link verification, session reads and
sign-out. Everything else is reached through server actions with the app's
own limits, which already count in Redis (`src/server/lib/rate-limit.ts`). An
audit of other per-process state found nothing else that changes meaning
with replicas: module-level values are constants; the PDF render slots
(2 per process), the error reporter's budget and the database pool (10
connections per process, against Postgres's 100) are per-process by design.

**Decision:** better-auth's `rateLimit.customStorage` (1.7's atomic
`consume`) is backed by Redis ([rate-limit.ts](../../src/server/lib/rate-limit.ts),
wired in [auth-options.ts](../../src/lib/auth-options.ts)):

- One `MULTI`: `INCR`, `EXPIRE … NX`, `TTL` on `ratelimit:better-auth:<ip>|<path>`.
  Allowed while the count is at most `max`; otherwise refused with the
  window's remaining seconds. The window starts at the first request and is
  never extended.
- The connection is the app limiter's, opened on first use (builds need no
  Redis), with the same 2-second cap.
- **It fails open.** If Redis errors or is slow, the request is allowed and
  an error is logged. Refusing would sign everyone out of a working site over
  a Redis blip; the tokens on these routes are long random values, and the
  Cloudflare rule and Traefik's in-flight cap still stand in front (ADR-047).
  The app's own limiters keep their per-limiter choice (sign-in links refuse).

Rules, the production-only switch (off in e2e) and IP handling (ADR-037) are
unchanged.

**Rejected:** better-auth's `secondaryStorage` (it would also move sessions
and verification tokens into Redis, a much larger change); `storage:
"database"` (a Postgres write on every limited request); failing closed (see
above).

**Consequences:** Limits hold across any number of web instances. Each
limited request costs one Redis round trip. During a Redis outage these
routes are limited only by Cloudflare and Traefik. A real-Redis test proves
two instances share one count
([rate-limit.auth.redis.test.ts](../../tests/integration/rate-limit.auth.redis.test.ts)).

**Revisit when:** sessions move to Redis (then `secondaryStorage` covers
both), better-auth changes its storage contract, or the web runs somewhere
without our Redis.
