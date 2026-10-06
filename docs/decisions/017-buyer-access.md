---
id: ADR-017
title: 'Buyer access: one name per order, Find my order, optional passwordless accounts'
date: 2026-09-20
status: accepted
area: Tickets and email
supersedes: []
extends: []
---

# ADR-017 — Buyer access: one name per order, Find my order, optional passwordless accounts

**Date:** 2026-09-20 · **Status:** Accepted

**Context:** A buyer who closed the tab before paying had no way back
except the C1 email. Accounts were wanted but must never be required to
buy. Asking for a name per ticket was friction nobody needed at registration.

**Decision:**

- **One name per order.** The form takes the buyer's name only; the Zod
  schema fills `attendee_names` with it for every ticket, and the service
  still enforces names === quantity. Tickets stay named and transferable:
  each ticket's name is editable on its own page until registration closes.
- **Find my order** (`/orders/find`) needs no account and no email: the
  reference (which the buyer typed into bKash) plus the phone used at
  registration, normalised with the same rule. One generic message for any
  mismatch; the reference is not a secret, but which phone it belongs to is.
- **Optional accounts are passwordless.** better-auth's `magicLink` plugin:
  `/account/sign-in` emails a 15-minute link (through the worker, like every
  email — Invariant 7); the first sign-in creates the account. **My orders**
  (`/account`) lists orders whose `buyer_email` equals the session email —
  proof of the email is the access rule, so past orders are covered without
  a `user_id` column. Registration pre-fills name/email when signed in.
- **Roles.** `users.role` (`admin` | `buyer`, migration `0009`, never
  settable from a request). Before this slice "a session exists" meant
  "is the admin" (sign-up was off); now sessions are free to obtain, so
  **every admin server action calls `requireAdmin()` itself** — the
  `(protected)` layout only guards page renders, and a server action is
  its own POST endpoint. A buyer session at `/admin` is sent home. Admins keep the password login only: a
  magic link requested for an admin email is silently not sent (the
  endpoint still says "sent", so admin emails stay unenumerable).
  `admin:create` sets the role; `admin:promote` exists for the admin created
  before the column.
- **Throttling is ours, not better-auth's.** better-auth's limiter runs
  only in its HTTP handler (and only under `NODE_ENV=production`, in
  memory); the UI calls `auth.api.signInMagicLink` directly, which
  bypasses it. `src/server/lib/rate-limit.ts` is a Redis fixed-window
  counter: sign-in links 10/min per IP and 3/15 min per address (Redis
  down → refused, since the email could not be queued either); Find my
  order 20/min per IP (Redis down → allowed, it only reads Postgres).
- **Test seam:** `E2E_EXPOSE_MAGIC_LINK=1` shows the link on the sign-in
  page so Playwright can follow it — a positive gate on `APP_ENV=test`
  (what the Playwright web server sets), so a staging or production box
  that inherits the flag never shows a link; `NODE_ENV` plays no part
  because `next start` forces it to `production` even for the e2e build.
  The e2e server also runs with `BETTER_AUTH_URL` on its own port, because
  the verify endpoint redirects to `callbackURL` on that origin.

**Consequences:** Every public page reads the session (they were already
dynamic). The `magicLink` plugin must be passed to `betterAuth()` as a
concrete value (`magicLinkPlugin()`), not inside the widened
`BetterAuthOptions`, or `auth.api.signInMagicLink` is erased from the type.
**Deploy order matters once:** migration `0009` defaults every existing
user to `buyer`, so run `pnpm admin:promote <email>` right after it or
the admin is bounced to the home page until someone does.

**Revisit when:** buyers want to change the email on an order (then a
`user_id` link and an admin tool), or a second organizer needs their own
admin.
