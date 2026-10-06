---
id: ADR-048
title: 'Bot check: Cloudflare Turnstile on the public forms'
date: 2026-10-02
status: accepted
area: Security and auth
supersedes: [ADR-019, ADR-038]
extends: []
---

# ADR-048 — Bot check: Cloudflare Turnstile on the public forms

**Date:** 2026-10-02 · **Status:** Accepted · supersedes the sign-in limiter parts of ADR-019 and the reset rate rule of ADR-038

**Context:** The limits of ADR-046/047 count per phone and per address,
and a script can bring many of both. Five public forms cost us something
real on every submit: an order holds seats for 24 hours, the sign-in and
reset forms send an email, Find my order is a lookup that can be
enumerated, and the admin login takes password guesses. better-auth also
served three of them over HTTP (`/sign-in/email`, `/sign-in/magic-link`,
`/request-password-reset`), so a bot could post there and skip our server
actions and their limits entirely. The site already sits behind
Cloudflare (ADR-045), which offers Turnstile free.

**Decision:**

- **Turnstile on five forms:** registration, Find my order, buyer sign-in,
  admin login, admin forgot password. Each has its own `action`
  (`TURNSTILE_ACTIONS`, `src/lib/turnstile-config.ts`).
  - **Not on the trxID payment form:** it is reachable only from an
    order's own page, the trxID is unique in the database (Invariant 3)
    and a person checks every one. A challenge there would only stand
    between a paying buyer and their tickets.
  - **Not on the promo code "Apply" check:** it changes nothing and
    sends nothing; the order it leads to is checked anyway.
- **Order in each server action:** Zod parse → `passesHumanCheck` →
  the existing rate limiter → the service or auth call. A refused check
  returns the form's normal error (`HUMAN_CHECK_FAILED`) with the typed
  values kept; nothing is held, sent or counted against a limiter, so a
  bot can't spend a real buyer's (or the admin's) budget.
- **Per-form action and hostname claims.** Siteverify echoes the action
  and the host the token was solved on; both must match, so a token
  solved on one form, or on someone else's site with our public site
  key, is refused. The verifier runs before any service call, never
  inside a transaction (Invariant 7).
- **Fail open on Cloudflare, fail closed on us.** A network error,
  timeout, 5xx, unknown answer or `internal-error` lets the submit
  through (logged `warn`): the site is served through Cloudflare, so an
  outage there is rare and short, the limits and the per-phone cap still
  hold, and refusing would close registration for everyone because of a
  third party. A rejected secret (`invalid-input-secret`) refuses every
  submit and logs `error` (`turnstile secret rejected by Cloudflare`):
  allowing would switch the bot check off without anyone noticing, and
  the deploy checklist catches it in a minute.
- **Test keys are refused when deployed.** `readTurnstileConfig` throws
  for `APP_ENV` staging or production when either key is missing or is a
  Cloudflare test key, because the test secret accepts a dummy token
  anyone can send. Dev, CI, the e2e suite and the load stack (which
  runs the production image with `APP_ENV=local`) default to the test keys,
  and the action and hostname claims are skipped there (test answers
  carry neither).
- **The site key is read at request time** and passed from the page to
  the form as a prop, not `NEXT_PUBLIC_*`: images are built with
  placeholder env (ADR-036).
- **better-auth's HTTP endpoints for those forms are disabled**
  (`disabledPaths` in `src/lib/auth-options.ts`): `/sign-in/email`,
  `/sign-in/magic-link`, `/request-password-reset`, and the unused
  `/send-verification-email`. The server actions call `auth.api.*`
  directly, which disabled paths don't affect; the token links in the
  emails (`/magic-link/verify`, `/reset-password`) stay open.
- **The widget resets after every server answer.** A token is single-use,
  so the form's action state is the widget's reset signal; otherwise a
  second submit after any error would always fail the check. It renders
  `interaction-only`: most visitors never see it.
- **A submit before the token exists is held, not refused.** A quick
  click or a password manager submitting on autofill would otherwise
  post with no token and get the bot message (the e2e suite's sign-ins
  failed this way). The widget prevents that submit, says "Checking you
  are not a bot", and sends it when the token arrives; if the widget
  fails instead, it sends it anyway so the server answers with the bot
  message.
- **No-JS posts are no longer supported on these five forms.** The token
  comes from Cloudflare's script; the widget shows a `<noscript>` note.

**Consequences:**

- Two new required variables in production, `TURNSTILE_SITE_KEY` and
  `TURNSTILE_SECRET_KEY` (docs/ENVIRONMENT.md § Bot check); without them
  the production compose file refuses to start, and with test keys the
  five form pages throw. The widget is created in the Cloudflare
  dashboard (docs/infra/CLOUDFLARE.md § Turnstile).
- `frame-src https://challenges.cloudflare.com` in the CSP; the script
  itself loads from our bundle under `'strict-dynamic'` (ADR-043).
- better-auth's own limiter never ran on `auth.api` calls, so the admin
  login now has its own: every attempt counts per IP (10 a minute), and
  only wrong passwords count per address _from that IP_ (5 per 15
  minutes, checked before the attempt, counted after an `APIError`).
  Not an address-wide count: Turnstile makes a guess cost one solve, not
  a refusal, so anyone willing to solve 5 widgets every 15 minutes (a
  person, a solving service, or anyone while siteverify fails open)
  could keep the real admin out with the right password, and stall
  payment approvals. The price: a guesser spread over many IPs is held
  only by the per-IP limit, Turnstile and the password's strength.
  The forgot-password per-address limit (3 per 15 minutes) can still be
  spent by anyone; it only delays a reset email and never blocks a
  sign-in.
- A visitor with a strict content blocker, or without JavaScript, can't
  send these forms; the widget says so. Accepted: a bot check that works
  without a script is no check.
- One extra request to Cloudflare per submit (3 s timeout), outside any
  transaction.
- Tests: unit for the verifier (each refusal reason, fail open vs
  closed, no fetch for a missing token) and for each protected action
  (refused before the limiter and the service, values kept); the e2e
  suite runs on the test keys.

**Rejected:** better-auth's captcha plugin (it guards only better-auth's
own HTTP endpoints, not our server actions; we disable those endpoints
instead); reCAPTCHA or hCaptcha (another third party seeing every
visitor, a weaker privacy story, more CSP sources, and Turnstile comes
with the Cloudflare we already use); a check on every form (the trxID and
promo forms above gain nothing and lose buyers).

**Revisit when:** Cloudflare's Turnstile analytics show real solve
failures for buyers (a network or browser we can't serve), bots get
through anyway (move to Bot Fight Mode or a paid bot plan), or the site
leaves Cloudflare.
