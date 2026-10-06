---
id: ADR-016
title: 'Transactional email: SES behind a Mailer port, sent by the worker, audited per message'
date: 2026-09-20
status: partly-superseded
area: Tickets and email
supersedes: []
extends: []
---

# ADR-016 — Transactional email: SES behind a Mailer port, sent by the worker, audited per message

**Date:** 2026-09-20 · **Status:** Accepted, partly superseded by [ADR-057](057-cloudflare-email-service.md) (the provider is now Cloudflare Email Service; SES is the rollback)

**Context:** Four emails are designed (C1 payment instructions, C2 tickets

- PDF, C3 rejected, C4 expired). Invariant 7 forbids network calls inside
  transactions; CLAUDE.md says all I/O is queued. The provider must be cheap
  at ~1,500 messages/month and must not drop messages on a launch-day spike
  (the free tier first considered capped at 100/day).

**Decision:**

- **Amazon SES**, region `ap-south-1`, via `@aws-sdk/client-sesv2` with raw
  MIME built by nodemailer's `MailComposer` (the only sane way to attach the
  ticket PDF). Cents per month; the sandbox → production request is the one
  manual step. `resend` was removed as never used.
- **A `Mailer` port** with two adapters: `ses` and `log` (pino + files in
  `tmp/emails/`). `MAILER` selects; the worker refuses to start in
  production with anything but `ses`, because a logged send is not a send.
- **Services never send.** Each state change exposes an after-commit hook
  (`onOrderCreated`, `onTicketsIssued`, `onOrderRejected`, `onOrderExpired`);
  the container wires them to `enqueueEmail(kind, orderId)`. A hook failure
  is logged and swallowed — an order that could not be announced is still
  an order, and Raj can re-send.
- **The worker renders and sends.** Job `email.<kind>` `{ orderId }`;
  deterministic id `<kind>__<orderId>` dedupes double enqueues (BullMQ
  forbids `:` in custom ids — found live); re-sends get a timestamp suffix.
  Five attempts with exponential backoff from 30 s; SES throttling maps to
  `MailerThrottledError` and is retried; the worker's limiter is 5/s.
- **The order's status is re-checked at send time** (`email.skipped` when
  it no longer fits — C2 only for `issued`), and **every send writes
  `order_events` `email.sent`** with the kind and provider message id;
  the final failed attempt writes `email.failed`. B8 answers "did they get
  it?" from the same audit trail as everything else.
- **Templates are `@react-email/components`** (tables, inline styles,
  600 px, system fonts) with a plain-text alternative; the QR is not
  embedded (hosted images hurt deliverability — the ticket page and PDF
  carry it).
- **The worker is bundled with esbuild** (`dist/worker.mjs`, ESM, packages
  external) and run by plain Node. tsx's CJS loader mis-resolves
  react-pdf's nested ESM exports (`@react-pdf/hyphenate/en-us`); a built
  artifact is also what the VPS should run.

- **Nothing after a successful send may fail the job.** The `email.sent`
  audit insert is wrapped: a Postgres blip there is logged (with the
  provider id) rather than thrown, because a retry would re-send and SES
  has no idempotency key. Permanent SES errors (rejected message, unverified
  domain, suspended account) map to BullMQ's `UnrecoverableError` — one
  `email.failed` row, no pointless retries; throttling and daily-quota
  errors are retried.
- **The app's producer connection fails fast** (`enableOfflineQueue: false`,
  2 s connect timeout, 3 s enqueue timeout) so a Redis outage can never
  hang a registration request; the hook logs and the order stands.
- C1 is skipped once `hold_expires_at` has passed even if the row is still
  `pending_payment` — a late job must not ask for money on a lapsing hold.

**Consequences:** `REDIS_URL` is now required by the app too (it enqueues).
C1 doubles the per-order message count — fine at SES prices. DNS (DKIM ×3,
SPF, DMARC) and Cloudflare Email Routing for `hello@` are documented in
ENVIRONMENT.md; until production access is granted only verified addresses
receive mail. `dist/worker.mjs` must run from the repo root (fonts are read
from `src/server/pdf/fonts`).

**Revisit when:** bounces/complaints need handling (SES → SNS → a
suppression list), or a second organizer wants their own sending domain.
