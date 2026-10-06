---
id: ADR-042
title: 'Discoverability: structured data, sitemap, robots, a generated share image'
date: 2026-09-29
status: accepted
area: Public site
supersedes: []
extends: []
---

# ADR-042 — Discoverability: structured data, sitemap, robots, a generated share image

**Date:** 2026-09-29 · **Status:** Accepted

**Context:** Every public page had a title, a description, a canonical
link and Open Graph tags (ADR-009), and private pages were `noindex`.
What was missing:

- nothing told search engines or AI assistants the facts of an event
  (when, where, how much, whether it is still on sale);
- no sitemap;
- `robots.txt` was Cloudflare's comments-only placeholder;
- `/admin/login` was indexable;
- pages without an event cover shared with no image at all.

**Decision:**

- **schema.org JSON-LD** (`src/lib/structured-data.ts`, pure and tested),
  rendered by one `JsonLd` component:
  - **Event** on each event page:
    - Dhaka times with their offset, an in-person `Place` in Dhaka, BD,
      and the organizer;
    - **one Offer per ticket type**, priced through `money.ts` (`"1200.00"`
      BDT). Availability follows the sale state: sold out → SoldOut; not
      yet on sale or registration not open → PreOrder; the type's window
      ended or registration closed → Discontinued.
    - A past event, or one without ticket types, has no offers.
    - **A private venue is never in it:** the event comes through
      `forPublic`, and the place uses `publicVenue`, so it names only the
      public area, or just "Dhaka".
  - **Organization + WebSite** on the home page (name, logo, Facebook,
    support contact).
  - **FAQPage** on `/faq`.
    - The answers are JSX. Server Components can't import
      `react-dom/server`, so `nodeText` walks the element tree for the
      text.
    - Google shows FAQ rich results only for a few kinds of site now;
      this is for AI assistants and answer engines.
  - **Injection-safe:** titles are typed by an admin, so the JSON escapes
    `<`, U+2028 and U+2029. A title containing `</script>` stays data.
- **`sitemap.xml`**: the nine public pages, plus every published or
  archived event with its `updatedAt`.
- **`robots.txt`**: the app's own. It disallows `/admin`, `/api/`,
  `/door`, `/orders/`, `/tickets/`, `/account` and the register pages,
  and links the sitemap.
- **`/.well-known/security.txt`** (RFC 9116), pointing at SECURITY.md's
  channels, with a rolling six-month `Expires`.
- **Per request, not at build.** At build time `SITE_URL` is a
  placeholder, and a prerendered file would advertise
  `build-placeholder.invalid`. So:
  - `robots.txt`, the sitemap and security.txt render per request;
  - `metadataBase` and the Open Graph defaults live in the **public**
    layout, which renders per request anyway;
  - the share image sits in `(public)/`.

  The root layout's metadata stays static and holds no URL. It also
  covers the pages Next prerenders (the 404 page,
  `/admin/forgot-password`). A first version set `metadataBase` in the
  root layout: the Dockerfile's placeholder check refused the image, and
  production kept the previous deploy.

- **Generated images, built once:** the default share card
  (`opengraph-image`, `twitter-image`, 1200×630), the icon (512 px, also
  the Organization logo) and the Apple icon. They use the Noto Sans the
  ticket PDF already ships, so nothing is fetched from a font CDN at
  build. Event and home metadata **leave out** `images` when there is no
  cover, rather than sending an empty list, so the card applies.
- **Also:** `manifest.webmanifest` (name, colours, icons); a home title
  that says what the site is ("echoandaura · Live events and tickets in
  Dhaka"); the whole admin `noindex, nofollow` through `app/admin/layout.tsx`.
- **Left out:** an RSS feed (little value for one organizer's handful of
  events) and `llms.txt` (no major engine has said it reads it). Security
  headers are Phase 7.

**Consequences:**

- Search engines learn about a new event when they next read the
  sitemap. Search Console and Bing Webmaster need the sitemap submitted
  once (docs/infra/CLOUDFLARE.md → Search engines).
- Cloudflare's "managed robots.txt" may add its content-signals text
  around ours. Its rules are comments, so ours still decide.
- A new public page must be added to `STATIC_PUBLIC_PATHS`. A new
  private area must go into `DISALLOWED_PATHS` and also be `noindex`.

**Revisit when:** events get performers or a lineup (add `performer`), an
event can be cancelled or moved (`eventStatus`), or Bangla pages exist
(`inLanguage`, `hreflang`).
