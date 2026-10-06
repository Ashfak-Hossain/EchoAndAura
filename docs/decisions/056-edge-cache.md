---
id: ADR-056
title: Public pages cached at the Cloudflare edge for 30 seconds, anonymous visitors only
date: 2026-10-04
status: accepted
area: Performance
supersedes: []
extends: []
---

# ADR-056 — Public pages cached at the Cloudflare edge for 30 seconds, anonymous visitors only

**Date:** 2026-10-04 · **Status:** Accepted

**Context:** Every public page is dynamic: the layout reads the session,
and ADR-043's nonce CSP needs a fresh nonce in the header and on each of
~26 inline scripts, so the origin answers `Cache-Control: private,
no-store`. A page cost ~150-185 ms to first byte from Dhaka (the bare
network round trip is ~110 ms), and an on-sale rush would send every view
to a 2 vCPU VPS. Caching Next's data layer would save only ~40 ms, and
Subresource Integrity cannot replace the nonce (Next's SRI covers external
scripts only; the inline RSC scripts would need `'unsafe-inline'`).

A spike on `/faq` (2026-10-04) cached the whole response, header and HTML
together, and measured: a hit has first byte in ~40-55 ms; the browser
sees one nonce in both places, so the CSP holds and hydration and
navigation work; RSC requests (`?_rsc=`) are not cached; an RSC request
without a valid `_rsc` gets a 307 from Next that Cloudflare does not cache,
so HTML and RSC data cannot share an entry.

**Decision:**

- **One Cloudflare cache rule, `public pages for anonymous visitors`**
  (docs/infra/CLOUDFLARE.md § Cache rules): `/`, `/events`, `/archive`,
  `/about`, `/faq`, `/terms`, `/privacy`, `/refund`, `/contact`, and
  `/events/<slug>` but not `/events/<slug>/register`. Edge TTL 30 s,
  ignoring the origin's `no-store`; 500-526 never cached (the free plan stops at 526); Browser TTL follows
  the origin, so browsers still keep nothing.
- **Any cookie containing `better-auth` bypasses it** — admins, signed-in
  buyers, even an expired session. Those are the only visitors the public
  layout renders differently for.
- **No purge.** The 30 s TTL is the only freshness bound. Raj and the
  developer browse with their admin cookie, so they never see a cached
  page and their edits show at once; anyone else sees them within 30 s. A
  purge would put a Cloudflare token in the app or the deploy job to save
  at most 30 s. After a deploy, a page up to 30 s old may still be served:
  none of the cached pages has a form or server action, the build's static
  files stay in the edge cache, and Next reloads the page in full when it
  meets a newer build.
- **The contract a cached page keeps:** it renders the same for every
  anonymous visitor with the same URL, and sets no cookie.
  `tests/e2e/public-edge-cache.spec.ts` checks the cookie half for every
  path on the list; a page that starts varying per visitor (by IP, header
  or cookie other than the session) must come off the list first.
- **Nothing else changes.** Registration, the order and ticket pages, the
  account, admin, door and API are never cached. Inventory is held by the
  database (Invariant 2), so a count up to 30 s old on a cached page can
  never sell a ticket that is not there.

**Consequences:**

- Within one 30 s window, anonymous visitors to the same page share one
  CSP nonce. A nonce only matters where an attacker can inject HTML; the
  cached pages reflect no visitor input, and `'strict-dynamic'` still
  applies. ADR-043's "new on every request" now holds per edge entry.
- A count, a "Sold out" chip or a newly published event can be up to 30 s
  late for anonymous visitors. Ticking "Hide how many tickets are left"
  (ADR-055) can leave the old count visible for up to 30 s.
- A 404 (an unpublished slug) can be cached for 30 s; a 5xx is not.
- Cloudflare's Email Address Obfuscation was switched off the same day:
  its injected decoder broke the CSP and hydration (React #418) on every
  page, cached or not, and the address was already plain in the RSC data.

**Rejected:** Next data-layer caching alone (~40 ms gain, the page still
rendered per request); SRI in place of the nonce (needs `'unsafe-inline'`);
purging on publish or deploy (a token and a moving part to save ≤ 30 s);
a longer TTL with purge (counts change with every order, not just admin
edits).
