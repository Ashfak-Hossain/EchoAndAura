---
id: ADR-019
title: Archive read model, error reference from Next's digest, auth limiter off only in e2e
date: 2026-09-21
status: partly-superseded
area: Public site
supersedes: []
extends: []
---

# ADR-019 — Archive read model, error reference from Next's digest, auth limiter off only in e2e

**Date:** 2026-09-21 · **Status:** Accepted, partly superseded by [ADR-048](048-bot-check-turnstile.md) (better-auth's `/sign-in*` limiter never covered the admin login, which calls `auth.api`; the login now has its own limiter, and `/sign-in/email` is disabled)

**Context:** The last Phase 2 screens: A6 `/archive` and the A8 500 page.
Plus two e2e flake causes found on 20 Sep that made every full run fail
first time.

**Decision:**

- **Archive = the home page's past rule, uncapped.** `selectArchiveEvents`
  sits next to `selectHomeEvents` (`src/server/lib/home-events.ts`) with
  the same membership (started before now, published or archived, never
  draft — an archived _future_ event was pulled on purpose), so "See all
  past events" can never show fewer than the strip. One events query, no
  capacity query: nothing in the archive is on sale.
- **Error reference is Next's `digest`.** Next attaches a digest to every
  server error and prints it in the server log, so `ERR-<first 8>` on the
  page is already greppable — no logging plumbing, no error table. A
  client-only error has no digest and gets a one-off random reference
  from lazy `useState` (the React-compiler lint forbids reading refs in
  render). Three boundaries share one `ErrorPage`: the public group
  (inside the shell), the admin group (admin wording, "Back to
  dashboard"), and `global-error.tsx` for a failed root layout.
- **better-auth's limiter stays on in production and off in e2e.**
  `rateLimit.enabled` is `NODE_ENV === 'production'` unless
  `APP_ENV === 'test'`. Its `/sign-in*` rule (3 per 10 s per IP) is real
  brute-force protection for `/admin/login`; the Playwright build is also
  a production build but signs in as the admin from six workers at once.
  The long verification spec gets `test.slow()`.

**Consequences:** In production behind a proxy, better-auth needs the
client IP header (`advanced.ipAddress.ipAddressHeaders`, e.g.
`cf-connecting-ip`) or every visitor shares one sign-in bucket — a Phase 6
deployment item, noted in the RUNBOOK plan. The archive is dynamic like
the home page.

**Revisit when:** attendance counts land on archive cards (Phase 6
reports), or a maintenance page is needed (reverse proxy, Phase 6).
