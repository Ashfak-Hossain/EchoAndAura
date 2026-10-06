---
id: ADR-018
title: 'Static pages: copy in TSX, contact from env, a native accordion'
date: 2026-09-20
status: accepted
area: Public site
supersedes: []
extends: []
---

# ADR-018 — Static pages: copy in TSX, contact from env, a native accordion

**Date:** 2026-09-20 · **Status:** Accepted

**Context:** The registration checkbox said "I agree to the terms" with no
terms page behind it; tickets and emails said "refunds are handled outside
the app" with no policy to point at. The design (canvas 2, A7) fixes one
long-form template for About/Terms/Privacy/Refunds/Contact and a FAQ
accordion whose rows are shareable anchors.

**Decision:**

- **Copy lives in TSX**, not a CMS, MDX or the rich-text editor. Six pages
  that change a few times a year; a `StaticPage` template
  (`src/components/public/static-page.tsx`) plus a JSX body per page is
  typed, reviewable in a diff, and needs no dependency. The body reuses the
  `.rich-text` styles from globals.css so a policy reads exactly like an
  event description — one prose style for the public site. ADR-010's
  editor stays for organizer-authored event copy only.
- **Every number a page promises is a constant in `src/content/site.ts`**
  (verification SLA, hold hours, refund working days, rename cut-off) and
  the order page imports the SLA from there too. When the organizer changes
  a promise, it changes everywhere at once. The FAQ items are data in
  `src/content/faq.tsx`; their ids are permanent anchors.
- **Contact details come from the environment** (`ORGANIZER_CONTACT_EMAIL`,
  `ORGANIZER_PHONE`, `FACEBOOK_PAGE_URL`) through `ContactCard`, which
  omits each unset channel and renders nothing when none is set; `/contact`
  says so instead of showing a blank.
- **FAQ = native `<details name="faq">`.** The HTML exclusive-accordion
  attribute gives "one open at a time" with no JavaScript; the only client
  code opens the item named in the URL hash (browsers scroll to an anchor
  but do not expand a closed `details`). The question text toggles; a
  separate `#` link sets the hash, so a link inside the summary never
  fights the toggle.
- **The copy is a draft the organizer signs off**, not legal advice. The
  refund promises (bKash transfer within three working days; full refund on
  cancellation or postponement) and the 4-hour SLA come from the design
  frames and PROGRESS.md lists them for confirmation. Terms name the law of
  Bangladesh and no legal entity; both are placeholders until confirmed.

**Consequences:** Pages are static server components with canonical URLs
and are indexable (unlike order and account pages). Changing copy is a
code change with a `LAST_UPDATED` bump. Browser support for `details
name=` is Chrome 120+, Safari 17.2+, Firefox 130+; older browsers get an
accordion where several rows can be open, which is harmless.

**Revisit when:** the organizer wants to edit copy without a deploy (then
a `site_pages` table behind the existing rich-text editor), or a second
language arrives (post-launch Bangla).
