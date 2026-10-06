---
id: ADR-038
title: 'Admin accounts: change password, forgot password, change email'
date: 2026-09-28
status: partly-superseded
area: Security and auth
supersedes: []
extends: []
---

# ADR-038 — Admin accounts: change password, forgot password, change email

**Date:** 2026-09-28 · **Status:** Accepted, partly superseded by [ADR-048](048-bot-check-turnstile.md) (`/request-password-reset` is disabled over HTTP, so its better-auth rate rule is gone; the server action's own limits stay)

**Context:** Until now an admin password could only be reset "from the
server", and an admin could neither change their password nor move the
account to another address. The organizer (Raj) gets an account with a
password chosen for him and must be able to change it himself, recover
it if forgotten, and move the account if his email is ever compromised.
Buyers have no password (they sign in by magic link) and must not get one.

**Decision:** Use better-auth's own flows; add pages, rules and emails
around them.

- **`/admin/account`** (in the admin menu as "Your account"):
  - _Password_: current, new (at least 12), again. `changePassword` with
    `revokeOtherSessions`. better-auth replaces this browser's session
    too, and the new cookie counts from the next request, so the action
    redirects (`?password=changed`) rather than re-rendering.
  - _Email_: new address plus the current password (`verifyPassword`, so
    an unlocked computer is not enough), then `changeEmail`, which emails
    a link to the **new** address. Nothing changes until it is clicked.
    At the same moment a **notice goes to the current address**, before
    anything changes, so a stranger's attempt is seen in time. On the
    click, `afterEmailVerification` deletes every session of the account,
    including the one better-auth just gave the clicking browser: the
    owner signs in again with the new address.
- **Forgot password** (`/admin/forgot-password` → email → the link →
  `/admin/reset-password`): `requestPasswordReset` / `resetPassword`,
  links valid 1 hour and used once, `revokeSessionsOnPasswordReset`.
  The answer is the same whether or not the address exists.
  `sendResetPassword` sends **only for admins**; for a buyer it does
  nothing (a password would be a second way into a buyer account).
- **Rules:** a new password is 12 to 128 characters and differs from the
  current one. `minPasswordLength` applies to new passwords only;
  sign-in still accepts an older 8-character password, so nobody is
  locked out. `create-admin` enforces 12 too.
- **Closing side doors:** `/change-email` is in better-auth's
  `disabledPaths`, so over HTTP it answers 404 and the password-checked
  page is the only way. `/request-password-reset` gets a better-auth
  rate rule (3 per 15 min); the pages have their own limits too, because
  `auth.api` calls skip better-auth's limiter. The proxy lets a
  signed-out visitor reach only `/admin/login`, `/admin/forgot-password`
  and `/admin/reset-password`.
- **Emails** (reset link, confirm new address, change notice) go
  through the queue as one job, `auth.account`, with a discriminated
  payload the worker parses again. Like the sign-in link, a job carrying
  a link is dropped once sent.

**Found while building it:** since ADR-036 the rate limiter connected to
Redis on its first request, with the producer's fail-fast client, which
refuses commands until connected. So the first rate-limited request
after every start was refused ("Too many attempts"). The limiter now
has its own connection role that waits for the connection, with a
2-second cap per count (`withTimeout`). An integration test on a real
Redis shows both the fix and the old failure.

**Consequences:**

- While SES is in the sandbox, these emails reach only verified
  addresses (the domain, the organizer's Gmail, the developer's Gmail).
  Changing an admin email to an unverified address sends nothing until
  production access (docs/infra/AWS.md).
- A lost inbox plus a forgotten password still needs the server
  (`create-admin` a new account, or a database fix). Two admins who can
  each reset the other is the practical answer.
- No audit rows: `order_events` is for orders. Changes are logged with
  the admin's email, and the notice email is the owner's record of an
  email change.

**Revisit when:** a third admin appears (then roles and an admin list),
or 2FA for admins is wanted (better-auth has a plugin).
