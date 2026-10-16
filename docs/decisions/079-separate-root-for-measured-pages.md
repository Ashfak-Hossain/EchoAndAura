---
id: ADR-079
title: 'The measured pages get a root layout of their own'
date: 2026-10-16
status: accepted
area: Public site
supersedes: [ADR-077]
extends: [ADR-043]
---

# ADR-079 — The measured pages get a root layout of their own

**Context:** ADR-077 kept Cloudflare's analytics beacon off unmeasured
pages with a click guard: a link from a measured page to an unmeasured one
became a full page load. On 2026-10-16 the production dashboard listed
`/account/sign-in`, from an iPhone, with no paint timing. That is the
signature of an in-app navigation, on a page the beacon must never see.

The cause was history, not a click. A visitor lands on an unmeasured page
(no beacon) and follows a link to a measured one. Next.js moves there
in-app, so both history entries share one document. Then that measured
entry gets a new document with the beacon: a reload, iOS restoring the
tab, or coming back from another site (our pages are `no-store`, so the
browser never restores one from its back-forward cache). The unmeasured
entry before it is now part of the beacon's document. Back to it is a
same-document move, which the beacon reports and the guard never sees,
because it is not a click. Checked with the real beacon in Chromium,
WebKit and an iPhone profile, for sign-in, an order, a ticket, Find my
order and the register form. Smaller gaps: sign-out re-rendered the
layout with the guard, and a server-action redirect from a measured page
to an unmeasured one would have taken the beacon along. Production had no
orders yet, so only the sign-in address reached the dashboard.

**Decision:** Separate the measured pages by root layout, and let Next.js
do the full page load. Next.js loads a new document for any navigation
from one root layout to another: a link, `router.push`, a server-action
redirect, Back and Forward. So the beacon's document never holds an
unmeasured page's history entry.

- **Four roots, no `src/app/layout.tsx`.** `(measured)/` holds the
  measured pages: home, the events list, an event page, archive, about,
  FAQ, contact and the three policies, plus the share images.
  `(public)/` holds the register form, orders, tickets, the account and
  the language action. `admin/` and `door/` are roots too.
- **Shared parts, not copies.** [root-document.tsx](../../src/app/root-document.tsx)
  renders `<html>`, `<body>` and the fonts for every root.
  [public-shell.tsx](../../src/components/public/public-shell.tsx) is the
  header, footer and translations of both public roots. Each group
  re-exports the same error and not-found pages, and `admin/not-found.tsx`
  renders the public 404 as before.
- **A URL no route matches** gets [global-not-found.tsx](../../src/app/global-not-found.tsx)
  (`experimental.globalNotFound`, Next.js 16.4): with several roots there
  is no single layout to hold a 404. It renders per request
  (`connection()`). Prerendered, it has no CSP nonce and the CSP blocks
  its scripts (checked). It never has the beacon. Each root names itself
  in `data-root` on `<html>`, so the e2e suite can tell this page from
  the (measured) 404, which looks the same.
- **The beacon** is rendered by the (measured) layout when the token is
  valid and the request has a nonce
  ([web-analytics.tsx](../../src/components/public/web-analytics.tsx)).
  No request header from the proxy any more. The proxy keeps its allowlist
  only to add the report origin to `connect-src`, as a second lock
  ([web-analytics.ts](../../src/lib/web-analytics.ts)). A unit test keeps
  that allowlist equal to the pages under `(measured)/`, and checks that
  nothing else in `src/` imports the beacon, the shared public shell
  included.
- **Gone:** `WebAnalyticsGuard`, `takeOverClick`, `needsFullLoad` and the
  `x-ea-web-analytics` header.
- **`Referrer-Policy: strict-origin` (ADR-077) now carries weight.** Every
  measured page reached from an unmeasured one is a new document, and the
  beacon reports `document.referrer`. Without the policy, Chromium
  reported the previous page's full address that way (checked).

**Checked** (2026-10-16 and 17, production builds, the real beacon
2026.10.0, reports captured before they left): first in a small separate
app with the same layout, then in this one. Links, the phone menu, a
server-action redirect and Back and Forward each load a new document
across the boundary, after a reload too. No history entry a document
shares lies across it. A harness of 48 scenarios (history traversal,
links, adversarial cases and server actions, each in Chromium, WebKit and
an iPhone profile), the original leak among them, reported no unmeasured
address. The e2e spec [public-analytics-boundary.spec.ts](../../tests/e2e/public-analytics-boundary.spec.ts)
proves the full loads without the beacon.

**Rejected:**

- Widening the guard (both directions, a wrapper for `router.push`, a
  `popstate` hook): it sees clicks, and the leak was a history traversal.
  Every new way to navigate would be another hole.
- `spa: false`: the beacon still reports the current address when the
  tab is hidden (ADR-077).
- Removing analytics: the owner wants visit counts, and this fix deletes
  more code than it adds.
- A catch-all route instead of `global-not-found`: it would match every
  unknown URL inside one group, so the 404 for `/admin/x` or `/door/x`
  would pick a root by accident.

**Consequences:** A link from an unmeasured page to a measured one is now
a full page load too, a little slower (order page → home, for example).
A visitor who lands on an unmeasured page and then moves to a measured one
is now counted: that page is a new document with the beacon. The
generated share image moved with the measured pages, so a (public) page
has no `og:image`; all of them are `noindex`, and an order or ticket
address is not one to share. A new page
must go into the right group. Put it in `(public)/` unless it should be
measured; a measured one also goes on the allowlist, and the unit test
fails until both agree. The edge cache rule (ADR-056) is a third list
of the same pages, kept by hand. The 404 page depends on an experimental
Next.js flag: the boundary e2e spec checks that unknown URLs, under
`/orders`, `/tickets`, `/door`, `/api` and `/admin` too, render in the
global root, and the security-headers spec that the 404 has a nonce.

**Revisit when:** `globalNotFound` leaves experimental or changes; Next.js
stops loading a new document between root layouts (the e2e spec catches
it); the beacon starts reporting cross-document destinations; or
analytics is removed, and the public roots can become one again.
