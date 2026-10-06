---
id: ADR-049
title: 'Admin two-factor sign-in: authenticator app, backup codes, no shortcuts'
date: 2026-10-02
status: accepted
area: Security and auth
supersedes: []
extends: []
---

# ADR-049 — Admin two-factor sign-in: authenticator app, backup codes, no shortcuts

**Date:** 2026-10-02 · **Status:** Accepted

**Context:** The admin console is guarded by a password alone. Whoever
has that password approves or rejects payments, cancels tickets (our
only refund), changes the settings and the payment instructions, and
creates gate passes. One phished or reused password is enough. Turnstile
and the sign-in limits (ADR-048) slow a guesser down; they do nothing
against someone who already has the password.

**Decision:**

- **Mandatory for every admin.** No opt-out and no "later" button: an
  optional second factor is the one the stolen account doesn't have.
- **An authenticator app (TOTP, 6 digits, 30 s) plus 10 one-time backup
  codes**, through better-auth's `twoFactor` plugin
  (`twoFactorPlugin()`, `src/lib/auth-options.ts`). The secret and the
  backup codes are stored encrypted (`storeBackupCodes: 'encrypted'`)
  with `BETTER_AUTH_SECRET`, in `two_factors` (migration `0024`).
- **Sign-in in two steps.** After the right password, better-auth drops
  the new session and sets a signed `two_factor` cookie (10 minutes);
  `/admin/login/verify` asks for the code (or a backup code), and only
  then is the session created. That page is public in `src/proxy.ts`,
  because between the two steps no session exists.
- **Only server actions, never better-auth's HTTP routes.** Every
  `/two-factor/*` path is in `disabledPaths`, like the sign-in routes in
  ADR-048; the actions call `auth.api.*` behind their own per-IP
  limits. better-auth adds its own on top: 5 tries per sign-in challenge
  (then the password again), and the account locked for 15 minutes after
  10 wrong codes in a row, across challenges.
- **The other account routes are closed over HTTP too**: change or
  verify password, update or delete the user, list or revoke sessions,
  the reset-password POST, and the unused social and token routes. They
  need only a session cookie, which an admin who hasn't finished setup
  also holds; the app reaches them through `requireAdmin()`'d actions.
  Open stay the links in emails (`/magic-link/verify`,
  `/reset-password/:token`, `/verify-email`), `/get-session` and
  `/sign-out`.
- **`requireAdmin()` enforces it**, for pages and server actions alike:
  an admin without two-factor is sent to `/admin/two-factor/setup`.
  Setup (password, QR code, first code, backup codes) and sign-out are
  the only things reachable without it (`requireAdminPendingTwoFactor()`).
- **Turning it on ends every other session of that admin.** The flag
  is per account and `requireAdmin()` reads it on each request, while
  better-auth swaps only the session that confirmed the code. Without
  this, every password-only session (another device, one from before
  migration `0024`, one opened during the setup window) would pass as
  two-factor the moment the admin enrols anywhere. The confirm step
  deletes the admin's sessions created before its own code check
  (`revokeSessionsCreatedBefore`).
- **No email or SMS codes.** Email is the password-reset channel
  (ADR-038), so it can't also be the second factor, and SES is still in
  the sandbox. SMS: see Rejected.
- **No trusted devices.** A session already lasts about a week; a
  long-lived cookie that skips the code is one more thing to steal.
- **Recovery:** a backup code gets the admin in, once per code; it
  does not move two-factor to a new phone, and the console has no way
  to add one. A new phone, or the phone and the codes both gone, takes
  the reset script, which deletes the factor and every session of that
  admin (`pnpm admin:reset-2fa <email>` locally; in production
  `node dist/ops/admin-reset-2fa.mjs <email>` in the worker container),
  and the next sign-in starts setup again. A stolen phone may carry the
  saved password: change the password first, then reset, then enrol at
  once (docs/RUNBOOK.md § An admin lost their phone). No self-service
  reset: anything that skips the code without the server is the hole
  this closes.

**Consequences:**

- **The first page load after the deploy sends every admin to setup**:
  the developer and Raj. Do it at once. Until an admin has enrolled, the
  password alone still reaches setup, so a thief with the password could
  enrol their own phone.
- The server's clock must be synced (NTP; `timedatectl`, SERVER.md § 5).
  Codes are accepted one 30 s step either side, so a drift past that
  refuses every code.
- A code can be used again within its own 30 s window: better-auth does
  not remember used codes. Accepted: it still needs the password and a
  fresh, single-use challenge cookie.
- **Rotating `BETTER_AUTH_SECRET` makes every stored secret unreadable**:
  every admin then needs `admin:reset-2fa` (docs/ENVIRONMENT.md).
- The e2e suite signs in with a seeded, known test secret and computes
  the code; unit tests cover each action's refusals and limits.

**Rejected:** WebAuthn / passkeys (stronger and phishing-proof, but more
UI and device management than a one- or two-admin console needs now;
first choice when this is revisited); SMS codes (a cost per sign-in, and
SIM swaps are common); optional two-factor; trusted devices (above).

**Revisit when:** there are more admins than two people can recover by
hand, or better-auth's passkey support is something we can adopt
without building device management ourselves.
