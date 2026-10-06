---
id: ADR-035
title: 'Gate scanner Slice B2: a service worker so /door reloads without signal'
date: 2026-09-26
status: accepted
area: Gate scanner
supersedes: []
extends: [ADR-034]
---

# ADR-035 — Gate scanner Slice B2: a service worker so /door reloads without signal

**Date:** 2026-09-26 · **Status:** Accepted · extends [ADR-034](034-gate-scanner-offline.md)

**Context:** After Slice B the ticket list and the outbox survive on the
phone, but the page does not. iOS drops background tabs, and staff pull to
refresh. A reload without signal then left the gate with no page at all.

**Decision:**

- **One worker, for `/door` only.** `public/door/sw.js`, bundled by
  esbuild from `src/app/door/offline/sw.ts` (`pnpm sw:build`, run first
  by `pnpm build`; git-ignored). It is registered with scope `/door`, one
  level above its own folder, which the script allows with
  `Service-Worker-Allowed: /door`. It is served `no-cache`, so a fix
  reaches phones on their next load, and it takes over at once
  (`skipWaiting` + `clients.claim`). The rest of the site has no worker.
- **What it answers.** Opening `/door` is network first. Past 5 s, with
  no network at all, or on a 5xx, it opens the saved copy. With no copy
  it shows a self-contained "No signal" page that points to the printed
  list. `/_next/static/*` and `/vendor/*` are content-named, so they are
  cache first and saved as they load. Everything else goes to the network
  untouched: the door API, the RSC refresh of `/door`, other pages and
  other origins. Answers about a ticket come only from the server or from
  the ADR-034 list, never from a stale HTTP response.
- **The page saves itself; the worker never saves a page.** A page's
  first load is not controlled by a worker, and a worker cannot tell a
  signed-in page from a signed-out one. So once a status ping gets
  through, the scanner warms the decoder (the saved copy must be able to
  start the camera). It then fetches a fresh `/door` and saves it, plus
  every build file this load used (from Resource Timing), and deletes
  files that only an older build used.
- **Deleted when the session ends.** The saved page lists the gate's last
  scans, with names. End session, a 401, and a page the server renders
  signed out all delete it. A generation counter keeps a save still in
  flight from bringing it back. The privacy policy's door-phone row says
  so.
- **The saved copy opens offline.** A scanner whose first status ping
  gets no answer starts in offline mode, which is most likely the saved
  copy. The first person in the queue does not wait out a request that
  cannot answer. The banner adds "Counts as of HH:MM", because the header
  counts come from the load that was saved.
- **Production only.** In `next dev` file names change on every edit, and
  a worker would serve old code.

**Consequences:**

- A phone must open its pass once with signal. A phone that never did
  gets the "No signal" page.
- A page load on weak signal can take up to 5 s longer than before
  (then the copy opens), and the copy's header counts and last scans are
  from its save. The first status ping that gets through replaces them.
- Every scanner load costs one extra `/door` render (the save) and warms
  the decoder, about 1 MB of wasm that the browser caches for a year.
- A buggy worker could stick to phones. Mitigations: `no-cache` on the
  script, scope limited to `/door`, and a recovery step in DEVELOPMENT.md
  (clear the site's data).
- A future Content-Security-Policy needs `worker-src 'self'`.

**Revisit when:** the door is installed as a PWA (a manifest, a home-screen
icon); the site gets a CSP; or a phone has to start a session offline
(it cannot, since the pass cookie is set by the server).
