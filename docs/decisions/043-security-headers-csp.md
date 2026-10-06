---
id: ADR-043
title: Security headers and a nonce Content-Security-Policy
date: 2026-09-29
status: accepted
area: Security and auth
supersedes: []
extends: []
---

# ADR-043 — Security headers and a nonce Content-Security-Policy

**Date:** 2026-09-29 · **Status:** Accepted

**Context:** Only `/door` sent security headers (ADR-030). Every other
page sent no CSP and no HSTS, and advertised `X-Powered-By: Next.js`.
Admins type rich text that the public pages render (event descriptions,
sanitized by `RichText`); a CSP is the second line if a sanitizer bug
ever lets a script through.

**Decision:**

- **Static headers on every response** (`next.config.ts`, a
  `/:path*` rule placed before the `/door` rules so the door keeps
  `no-referrer` and `camera=(self)`):
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
    No `preload`: getting off the browsers' list takes months.
  - `X-Content-Type-Options: nosniff`;
    `Referrer-Policy: strict-origin-when-cross-origin`;
    `X-Frame-Options: DENY`; `Cross-Origin-Opener-Policy: same-origin`;
    `Permissions-Policy` turning off camera, microphone, geolocation and
    payment.
  - `poweredByHeader: false`.
- **A nonce CSP per request**, built by `src/lib/csp.ts` and set by
  `src/proxy.ts` on the request (Next reads the nonce from it and stamps
  its own scripts) and on the response:
  - `script-src 'self' 'nonce-…' 'strict-dynamic'`: only scripts with
    this request's nonce run, plus the chunks they load. No
    `'unsafe-inline'`.
  - `/door` adds `'wasm-unsafe-eval'` for the QR decoder; `worker-src
'self'` covers its service worker (ADR-035).
  - `img-src` allows `R2_PUBLIC_URL`'s origin (sponsor logos load from
    it directly), `data:` and `blob:` (the logo preview).
  - `connect-src` is `'self'`, plus `R2_ENDPOINT`'s origin **on signed-in
    admin pages only** (not sign-in or password reset): cover and logo
    uploads PUT straight to storage with a presigned URL (ADR-007). The
    first e2e run caught exactly this.
  - `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
    `form-action 'self'`, everything else `'self'`.
  - **Styles keep `'unsafe-inline'`.** The UI uses `style={…}` widely,
    and the shadcn chart writes a `<style>`. A style can't run code.
  - Dev adds `'unsafe-eval'` (React's error overlay).
  - Not on API routes, build assets, the image optimizer, `/vendor` or
    the service worker file: they carry no HTML.
- **Nonces need pages rendered per request.** Almost every page already
  was. The two Next prerendered are now dynamic:
  - `/admin/forgot-password` calls `connection()`;
  - a root `app/not-found.tsx` wraps the public 404 in the public
    layout. Unknown URLs used to get Next's unbranded default 404.
  - Still prerendered: Next's `_global-error` page (shown only when the
    root layout itself fails). It is plain HTML and reads fine without
    its scripts.
- **The e2e suite is the CSP test.** Every spec imports `test` from
  `tests/e2e/test.ts`, whose automatic fixture fails a test on any CSP
  violation in the browser, including the contexts the door specs open.
  The suite runs the production build, so the real policy is enforced.

**Consequences:**

- A new third-party script, font, image host, frame or connection needs
  a CSP change first; the e2e suite points at the violation.
- An inline `<script>` of our own would need the nonce, which the proxy
  would then also have to hand to the page (an `x-nonce` request
  header, per Next's CSP guide). JSON-LD is exempt: it is data and never
  runs.
- A page that becomes static loses its nonce and its scripts are
  blocked: keep pages dynamic, or revisit SRI (`experimental.sri`).
- HSTS covers every subdomain for a year: a new subdomain must serve
  HTTPS from day one.

**Revisit when:** Next's SRI leaves experimental (static pages with a hash
CSP); an analytics or payment script is added; or `preload` is wanted.
