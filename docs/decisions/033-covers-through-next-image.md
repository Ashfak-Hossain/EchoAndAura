---
id: ADR-033
title: 'Event covers through `next/image`: the allow-list from `R2_PUBLIC_URL`, sized per placement'
date: 2026-09-26
status: accepted
area: Performance
supersedes: [ADR-032]
extends: [ADR-007]
---

# ADR-033 — Event covers through `next/image`: the allow-list from `R2_PUBLIC_URL`, sized per placement

**Date:** 2026-09-26 · **Status:** Accepted · revisits ADR-007's "no image processing"; replaces ADR-032's "covers stay plain `<img>`"

**Context:** Covers are stored as uploaded, up to 5 MB, with no resizing
(ADR-007). Nine places drew them with a plain `<img>`, so a phone downloaded
the full file for a 240px card, and the event page fetched it twice. The only
reason for `<img>` was that the storage host is env-defined, and next/image
needs it allow-listed.

**Decision:**

- **Every event cover renders through `next/image`.** That covers the hero, the
  dormant hero, event cards, the past strip, the archive, the event page, the
  About band, and the two admin previews. Each has `width={1200}
height={630}` and a `sizes` taken from its layout (the constants sit beside
  the components). The browser gets a WebP at the width it needs from Next's
  optimizer (`/_next/image`), and pages keep their classes and boxes.
- **The allow-list is built from `R2_PUBLIC_URL` at build time**
  (`coverImagesConfig`, `src/lib/image-config.ts`). It is one pattern: the
  scheme, host and port of that URL, the path `<base>/**`, and no query string.
  The optimizer is a server-side fetcher anyone can point at a URL, so it may
  fetch from the storage bucket and nowhere else. An e2e test pins the 400s
  for another host and for another path on the storage host.
- **Local IPs only for loopback storage.** Next 16 refuses upstream images
  that resolve to private addresses (`dangerouslyAllowLocalIP`). It is on only
  when `R2_PUBLIC_URL`'s host is `localhost`, `127.x` or `[::1]` (MinIO in dev
  and e2e). The URL decides, not `APP_ENV`, so a build pointed at R2 can never
  fetch a private address.
- **Unset `R2_PUBLIC_URL`:** no host is allowed and the build warns (CI's
  `pnpm verify` has no storage env). A `staging` or `production` build
  fails instead of shipping a site whose every cover is broken.
- **Cache:** `minimumCacheTTL` is 31 days. This is safe because every upload
  gets a new key (`cover-<nanoid>`), so a URL's bytes never change and a
  replaced cover is a new URL. `deviceSizes` are the defaults without 3840.
  Formats stay WebP only, because AVIF encodes several times slower on the
  first request.
- **Priority:** the covers that are the largest paint (the hero, the dormant
  hero, and both event-page covers) are `loading="eager"` with
  `fetchPriority="high"`, as before. We don't use `preload`: these images are
  already in the server HTML, which is the case Next 16's docs point to eager
  loading for. The event page's phone band and desktop backdrop share
  `sizes="100vw"`, so they share a srcset, and the browser fetches one file
  for both.
- **Stays raw:**
  - Open Graph and share metadata use the storage URL, because crawlers need a
    stable, absolute 1200×630 image.
  - Sponsor logos stay `<img>`. They are small, often SVG (which the
    optimizer refuses without `dangerouslyAllowSVG`), drawn at exact fitted
    sizes, and served as attachments.
- **`sharp`** moves from devDependencies to dependencies, pinned at 0.35.4,
  so a production install always has it (Next also lists it as optional).
  sharp 0.35 ships prebuilt `@img/sharp-*` binaries and has no install
  script, so `pnpm-workspace.yaml` keeps `sharp: false`.

**Consequences:**

- `R2_PUBLIC_URL` is now also a **build-time** variable. Moving the bucket or
  domain means a rebuild.
- The first request for each cover width costs CPU on the app server (sharp
  decodes up to 5 MB). Later requests come from the disk cache in
  `.next-build/cache/images`, because `distDir` is `.next-build`. Deployment
  must keep that folder between releases, or every cover is re-encoded after
  each deploy.
- Tests that pinned a cover `src` now read the storage URL from the
  optimizer's `url=` parameter (`tests/unit/helpers/next-image.ts`).

**Revisit when:** the app runs behind a CDN that can resize (then use a custom
loader), or the server's CPU becomes the bottleneck on a show's launch day.
