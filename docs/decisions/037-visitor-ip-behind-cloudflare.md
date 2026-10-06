---
id: ADR-037
title: "The visitor's IP behind Cloudflare: read X-Forwarded-For from the right"
date: 2026-09-28
status: accepted
area: Security and auth
supersedes: []
extends: []
---

# ADR-037 — The visitor's IP behind Cloudflare: read X-Forwarded-For from the right

**Date:** 2026-09-28 · **Status:** Accepted

**Context:** The rate limits key on the caller's IP: find-order,
buyer sign-in, the promo check, the door-pass sign-in, and better-auth's
own limiter on `/admin/login`. In production a request goes visitor →
Cloudflare → Traefik → app, and each proxy appends the address it
received the request from to `X-Forwarded-For`. A test container
(`traefik/whoami`) on the live domain showed exactly what the app
receives (2026-09-28):

| Request                                 | `X-Forwarded-For` at the app             |
| --------------------------------------- | ---------------------------------------- |
| Normal, through Cloudflare              | `<visitor>, <Cloudflare edge>`           |
| Through Cloudflare, visitor sent a fake | `1.2.3.4, <visitor>, <Cloudflare edge>`  |
| Skipping Cloudflare, with fakes         | `<sender>` (Traefik replaced the header) |

The first case needed Traefik to trust Cloudflare's ranges
(`forwardedHeaders.trustedIPs`, docs/infra/SERVER.md § 13); without it,
Traefik replaces the header and every visitor looks like Cloudflare.

Two bugs remained. `requestIp()` took the **first** entry, which the
visitor controls: one fake per request dodges every limit. And
better-auth, by default, refuses a header with more than one entry: it
found no IP at all and put `/admin/login` in one bucket for the whole
internet, so anyone could keep the admin login locked.
`CF-Connecting-IP` is no answer on its own: a request that skips
Cloudflare can set it freely (the test passed a fake straight through).

**Decision:**

- One rule in both places: walk `X-Forwarded-For` **from the right**,
  skip every address inside Cloudflare's published ranges, and take the
  first one that isn't. That is the address Cloudflare itself saw.
  Anything further left is the visitor's own text and is never read.
- `src/lib/client-ip.ts` holds `CLOUDFLARE_RANGES` and
  `clientIpFromForwardedFor()`; `requestIp()` uses it; better-auth gets
  the same list as `advanced.ipAddress.trustedProxies` (its own
  implementation of the same walk).
- Range matching uses Node's `net.BlockList`: no dependency, no
  hand-written address arithmetic.
- IPv6 visitors are keyed by their /64 (better-auth does the same): a
  home or phone connection gets a whole /64, so per-address keys would
  let one device rotate past every limit.
- No usable address (no header, garbage where the visitor should be,
  only Cloudflare addresses) → `'unknown'`, one shared bucket, as before.
  `X-Real-Ip` is not a fallback: Traefik sets it to Cloudflare's edge.

**Consequences:**

- A visitor can't fake their way past a rate limit, through Cloudflare
  or around it. Around it, Traefik discards their header.
- **Cloudflare's ranges live in two places**: `CLOUDFLARE_RANGES` in the
  code and `trustedIPs` in the server's `traefik.yml`. They must change
  together. Cloudflare changes them rarely, with notice. Compare with
  https://www.cloudflare.com/ips/ once a year (with the Dokploy API key
  renewal) and when Cloudflare announces a change.
- If Cloudflare adds a range before we do, visitors arriving through it
  are keyed by that edge address (shared buckets, too strict), never a
  bypass.
- A Cloudflare Worker could send its own `X-Forwarded-For` from inside
  Cloudflare's ranges. That is throttling evasion by someone who controls
  code on Cloudflare's network, accepted: the limits are not a security
  boundary (`request-ip.ts` says so).
- Local dev and e2e have no proxy: every request shares one bucket, as
  before.

**Revisit when:** the site stops being behind Cloudflare (the ranges and
this rule go with it), or a second proxy is added in front of Traefik.
