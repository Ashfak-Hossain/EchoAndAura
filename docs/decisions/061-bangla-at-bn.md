---
id: ADR-061
title: 'Bangla at /bn: a proxy rewrite, a switch, and formatters by hand'
date: 2026-10-05
status: accepted
area: Localisation
supersedes: []
extends: []
---

# ADR-061 — Bangla at /bn: a proxy rewrite, a switch, and formatters by hand

**Date:** 2026-10-05 · **Status:** Accepted · Phase 8 slice L1 ([LOCALISATION.md](../systems/LOCALISATION.md))

**Context:** The public site gets a Bangla version at `/bn`, with English
staying at `/`. The design proposed moving the public tree under
`src/app/[locale]/` with separate root layouts for admin and the gate.

**Decision:**

- **A proxy rewrite instead of a `[locale]` folder.** `src/proxy.ts`
  rewrites `/bn/…` to the English route and sets `x-ea-locale: bn` on the
  request. next-intl runs without its own routing and reads that header
  (`src/i18n/request.ts`).
  - No files move, and the root `not-found`/`global-error` (ADR-043) keep
    working.
  - The English site is byte-for-byte the same routes, so the existing
    suite checks it.
  - The proxy **always** sets the header, so a visitor's own value never
    reaches a page: an English URL can't be rendered, or cached, in Bangla.
  - The proxy now also runs on public prefetches, but for the language
    step only (the `/bn` rewrite and the header). A prefetch carries a
    page's render. A CSP nonce on a public prefetch broke the navigation
    after it (the e2e suite failed), so those still get no CSP, as before.
- **The flag:** `PUBLIC_LOCALES` (`en` default; `en,bn`). With Bangla off,
  `/bn` is a 404 and the switch is hidden, so slices ship before the
  translation is reviewed.
- **The switch** (`English | বাংলা`, footer and phone menu) posts to a
  server action that sets `ea_lang`: one year, HttpOnly, SameSite=Lax. It
  then opens the same page in that language.
  - The cookie is set only there, never on a page view (ADR-056 contract).
  - With `ea_lang=bn`, a GET to an English page is redirected (307) to its
    `/bn` form. Admin, the gate, the API, files and off-site paths are
    excluded, and so are server-action POSTs.
  - There is no guessing from `Accept-Language`: the edge cache would serve
    the guess to everyone.
- **Links:** public pages use `@/i18n/link`, which keeps a link in the
  page's language; admin and the gate keep `next/link`.
- **Type:** Noto Sans Bengali through `next/font` (self-hosted, not
  preloaded). On `:lang(bn)` it is the per-glyph fallback after the Latin
  faces, with more line height.
- **Formatters by hand, not `Intl`.** Server and phone ICU data differ, and
  Node prints a Latin "PM".
  - Time: `formatDhaka*(date, 'bn')` gives `শনিবার, ১০ অক্টোবর ২০২৬, সন্ধ্যা ৭:৩০`,
    with the part of the day people say: ভোর 4–6, সকাল 6–12, দুপুর 12–3,
    বিকেল 3–6, সন্ধ্যা 6–8, রাত 8–4 (for Raj to confirm).
  - Money: `formatBDT(paisa, 'bn')` gives `৳১,২৩,৪৫৬.০০`, grouped in lakhs,
    with the conversion still only in money.ts (Invariant 1).
- **Catalogue:** `src/messages/en.ts`, and `bn.ts` typed
  `satisfies Messages`, so a missing key fails the type check. A unit test
  checks that the keys match both ways.

**Consequences:**

- E2E runs with `en,bn`; `public-bangla.spec.ts` covers `lang`, the CSP,
  links, the switch, the cookie redirect, and header spoofing.
- Bangla pages show English text until L2.
- Server redirects in the registration and order flow (L3) still go to
  English paths; the cookie redirect brings Bangla visitors back to `/bn`
  until then.

**L2 addendum (2026-10-05):**

- The public shell, home, events list, archive, event page, 404 and error
  page read their text from `src/messages/{en,bn}.ts`. The English output
  is unchanged; the existing unit and e2e suites pin it.
- Pure helpers that build sentences (`hero-copy.ts`, `phase-chip-label.ts`,
  `seo.ts`, the countdown label) take a `locale` and use `createTranslator`
  from `use-intl/core` (a direct dependency), so `src/server/` still never
  imports `next/*`.
- Numbers: Bangla digits everywhere on `/bn`. A count that English printed
  plain (`1439 days`) stays plain (`plainDigits`); grouped figures (money,
  tickets left) use `groupDigits`, which groups in lakhs for Bangla.
- Canonical URLs and `og:locale` follow the page's language (`bn_BD`);
  hreflang waits for L5.
- Unit tests render components through a vitest setup that backs next-intl
  with the real catalogue (`tests/unit/setup/intl.ts`, `useTestLocale`).
- The Bangla text is a **draft** by Claude, marked so in `bn.ts`, for Raj's
  review before Bangla is switched on.
- Not translated: names, venues, event titles and descriptions, ticket
  type names, and the organizer's settings text (the verification promise).
  Bangla event fields come in L5.

**Rejected:** the `[locale]` segment (about 60 files moved, multiple root
layouts, and the root 404 and global error rebuilt for little gain);
next-intl's own middleware (it expects that segment).
