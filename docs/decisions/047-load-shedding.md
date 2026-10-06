---
id: ADR-047
title: 'Load shedding: a cap on requests in flight, and a rate limit per address'
date: 2026-09-30
status: accepted
area: Performance
supersedes: []
extends: []
---

# ADR-047 — Load shedding: a cap on requests in flight, and a rate limit per address

**Date:** 2026-09-30 · **Status:** Accepted

**Context:** The load test (docs/LOAD-TEST.md) found how the site fails
under a flood: requests queue inside Node until the web's heap (half the
container's 1 GB) fills, and the process crashes and restarts. Launch
traffic is far below that, but one script or a viral post could cause
it, and the restart drops everyone mid-order. The security review
(ADR-046) also wanted an outer rate limit in front of the app.

**Decision:**

- **Traefik's `inFlightReq` middleware, `amount: 100`, on the `websecure`
  entrypoint** (docs/infra/SERVER.md § 21). Over 100 requests in
  progress for the host, Traefik answers 429 at once instead of
  queueing. On the entrypoint, not the app's router, because Dokploy
  regenerates the router labels on every deploy.
  - **Why 100 and not the faster 40.** On the load stack, 40 served a
    sustained flood best (72 pages a second, admitted p95 under a
    second, against about 30 at 60 and above). But 200 buyers pressing
    "Register" together got 40 holds and 160 instant refusals at 40,
    with seats left over; at 100 every seat went. At 100 in flight the
    web stayed near 250 MB even at 220 views/s, so the crash is gone
    either way. The on-sale burst happens at every event; a sustained
    flood from many addresses is Cloudflare's DDoS protection's job.
  - The default grouping (by `Host`) is what we want: behind Cloudflare
    every client address is Cloudflare's anyway.
- **One Cloudflare rate-limiting rule** (the free plan's only one):
  150 requests per 10 s per IP, everything except `/_next/`, block for
  10 s (docs/infra/CLOUDFLARE.md). The free plan matches on the path
  only, so it can't target form posts; counting pages, prefetches,
  posts and API calls together still stops one address from taking the
  in-flight budget from everyone else. Set well above one person
  because mobile carriers put many buyers behind one address.
- **The load stack mirrors it:** `ops/load/traefik/` and `--profile shed`
  put the same middleware in front of the web, so a change to the cap is
  measured before it is made.

**Consequences:**

- Under overload some visitors see a plain "Too Many Requests" (Traefik's
  or Cloudflare's) and try again, instead of everyone waiting until the
  process dies. A friendlier page would need a server that isn't the
  overloaded web.
- The cap is on the host, so door phones and admins share it with the
  public on event night; they are a handful of requests.
- Dokploy rewrites `traefik.yml` for some settings changes; SERVER.md
  § 21 has the check (`grep -c inflight-cap`).

**Rejected:** a cap in the app (Node would still accept and parse every
request); a queue in front of the web (Traefik has none, and a waiting
room is out of proportion for this size); Traefik's `rateLimit` per
address (it would duplicate Cloudflare's rule on the CPU being
protected, and must pick the visitor out of `X-Forwarded-For` exactly as
the app does).

**Revisit when:** the web runs as more than one replica (the cap is per
host, not per replica), public pages are cached at Cloudflare, or the
server changes size: re-measure on the load stack first.
