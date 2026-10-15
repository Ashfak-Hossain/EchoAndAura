---
id: ADR-077
title: 'Cloudflare Web Analytics: our own nonce, an allowlist of pages, a full page load out of them'
date: 2026-10-15
status: accepted
area: Public site
supersedes: []
extends: [ADR-042, ADR-043]
---

# ADR-077 — Cloudflare Web Analytics: our own nonce, an allowlist of pages, a full page load out of them

**Context:** The owner wants visit counts: how many people come, from where,
and which posts send them. The sales report (ADR-026) already counts orders
and money exactly; what is missing is traffic. The privacy policy promised
that nothing about a visitor goes to analytics, and the site runs a nonce
CSP (ADR-043). Some addresses are access keys: `/tickets/<code>` and
`/orders/<uuid>` (ADR-012, ADR-015), and the order page is where the buyer
types the trxID and sending number.

Cloudflare's beacon (read in `beacon.min.js` 2026.10.0) stays loaded for
the life of the document. It hooks `pushState` and the Navigation API and
reports each in-app navigation's path, and when the tab is hidden it sends
a last report with the address current at that moment. The register form
redirects into `/orders/<uuid>` without a page load (a server action), so a
beacon on the event page would follow every order there, and the buyer
then hides the tab to open the bKash app.

**Decision:** Cloudflare Web Analytics, with the beacon added by the app,
and never on a page that is not measured.

- **Terraform** creates the site with `auto_install = false` and a
  destruction guard ([analytics.tf](../../ops/terraform/cloudflare/analytics.tf)).
  The token goes into Dokploy as `CF_WEB_ANALYTICS_TOKEN`. Unset: no
  beacon. Cloudflare accepts only Account Settings → Edit for creating the
  site, so the Terraform token holds Read and gets Edit for that apply only
  ([TERRAFORM.md](../infra/TERRAFORM.md)).
- **The proxy decides** ([proxy.ts](../../src/proxy.ts),
  [web-analytics.ts](../../src/lib/web-analytics.ts)). A page is measured
  when the token is valid and its English route is on an allowlist of whole
  routes: home, the events list, an event page, archive, about, FAQ,
  contact and the three policies. Not the register form, orders, tickets or
  the account. It then passes the token to the layout in a request header
  it always removes first (prefetches included), and adds
  `https://cloudflareinsights.com` to `connect-src`. A new route is
  unmeasured until it is added.
- **The public layout renders the beacon** with the request's nonce
  ([web-analytics.tsx](../../src/components/public/web-analytics.tsx)),
  `spa: true` so in-app navigations between measured pages count. The
  token comes from env, and the header must equal it: a path the proxy
  skips (`/api/nope`) renders the not-found page in this layout with the
  visitor's own headers.
- **A full page load out of the measured pages**
  ([web-analytics-guard.tsx](../../src/components/public/web-analytics-guard.tsx)).
  Next to the beacon, a capture-phase click listener on `window` turns a
  plain click on a link to an unmeasured page of ours into
  `location.assign`, and stops the click there. `<Link>` and every other
  handler see nothing, so none can navigate in-app first. It goes on in a
  layout effect, in the same commit that makes the links live. The
  decision is a pure function (`takeOverClick`), unit-tested. The last report, sent as the page unloads, carries the measured
  page's address; the next page loads without the beacon. The rule is the
  allowlist itself, so a new route is left by a full load without anyone
  listing it.
- **Referrers are the origin only, site-wide** (`Referrer-Policy:
strict-origin` in [next.config.ts](../../next.config.ts), was
  `strict-origin-when-cross-origin`, ADR-043). A measured page that loads
  as a new document after a ticket or order page (a new tab, a footer link
  after a deploy, when Next falls back to a full load) would otherwise
  hand the beacon that address as `document.referrer`. Nothing of ours
  reads a same-site `Referer`; server actions and sign-in check `Origin`.
- **What is sent:** the page address without its query string or `#`
  part, the referrer (an origin), browser, device type and OS version,
  country (from the request), and Core Web Vitals with the CSS selector of
  the element involved. No cookies.
- **The privacy policy says so** ([privacy.tsx](../../src/content/policies/privacy.tsx)),
  names the measured pages, and says the beacon never runs on the
  registration form, order, ticket or account pages. Nothing goes to
  advertising. The stale "emails go through Amazon Web Services" became
  Cloudflare (ADR-057).

**Checked in a browser** (2026-10-15, production build, the live beacon,
reports captured before they left): home → events → an event page
reported only those three paths; the click to the register form and to
Find my order each loaded a new document without the beacon; the order
page, reached by the register redirect and then hidden, sent nothing; and
`/?x=1` was reported as `/`. No CSP error, no hydration warning.

**Rejected:**

- Cloudflare's automatic setup: it injects a script without our nonce,
  which the CSP blocks, and it would run on every page (email obfuscation
  broke hydration the same way).
- `spa: false`: it stops the navigation hooks, but the report on tab hide
  still reads the current address, so an order page reached in-app is
  still sent, and in-app moves between measured pages stop counting.
- Cloudflare's Web Analytics rules (path exclusions): they decide where
  Cloudflare injects the beacon on a page request, exist only for automatic
  setup, and see no request on an in-app navigation. Their Terraform
  resource can't be imported either.
- Accepting the leak in the policy: every order's address would reach the
  dashboard, and third-party script would run where the trxID is typed.
- `no-referrer` only on the unmeasured routes: a new route would leak
  until someone listed it, and each `/bn` form needs its own rule.
- A browser test with the beacon on: the token is read once at server
  start, so it needs a second e2e server; the beacon itself is unpinned
  and would be stubbed anyway. The decision is unit-tested, the wiring
  was checked in a browser, and the e2e server runs with the token empty.
- A separate root layout for the measured pages, so Next.js itself does a
  full load between them: the strongest guarantee, but it moves admin, the
  door and the not-found pages for one script.
- Google Analytics, Tag Manager and the Meta Pixel: cookies, a consent
  banner, and the advertising promise broken.
- Zone traffic analytics alone: counts requests, bots included, with
  little detail.

**Consequences:** Leaving a measured page for the register form, Find my
order or the account is a full page load, a little slower. The register form isn't counted; the event
page before it is, and the sales report counts orders exactly. The guard
covers link clicks only: a `router.push` or a server-action redirect from
a measured page to an unmeasured one would take the beacon along. Today
the only one is the language switch, which lands on a measured page. A
visitor who lands on an unmeasured page and moves in-app to a measured one
isn't counted (the layout, and so the beacon, is not rendered again).
Visitors who block `cloudflareinsights.com` aren't counted either, so
numbers run low. The beacon is third-party script, loaded unpinned from
Cloudflare's CDN (no versioned URL is published, so no SRI). It runs only
on measured pages, and the same company already terminates our TLS. The
dashboard is visible to every member of our Cloudflare account and any
token with analytics read. Our own pages now see only `https://echoandaura.com`
as the referrer, in logs too.

**Revisit when:** paid ads need conversions (Meta's Conversions API from
the server, not a pixel); a measured page gains a programmatic navigation
to an unmeasured one; Cloudflare offers path exclusions for manual
beacons; or the policy's promise changes.
