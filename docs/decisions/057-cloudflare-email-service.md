---
id: ADR-057
title: Email through Cloudflare Email Service; SES becomes the rollback
date: 2026-10-04
status: accepted
area: Tickets and email
supersedes: [ADR-016]
extends: []
---

# ADR-057 — Email through Cloudflare Email Service; SES becomes the rollback

**Date:** 2026-10-04 · **Status:** Accepted (supersedes the provider part of ADR-016)

**Context:** SES production access was refused twice (2026-09-21 and
2026-09-30). In the sandbox SES delivers only to verified addresses, so
a real buyer would get neither the payment instructions nor the tickets:
the last blocker before a real event. Cloudflare Email Service (launched
April 2026) sends from a domain already on Cloudflare, with no sandbox
once the domain is onboarded, and the owner bought Workers Paid for it on
2026-10-04 (3,000 emails/month included, then $0.35 per 1,000).

**Decision:**

- **A second adapter behind the same `Mailer` port**
  (`src/server/email/cloudflare-mailer.ts`). The worker POSTs JSON to the
  REST API (`/accounts/{id}/email/sending/send`) from the VPS; no Workers
  code. Everything above the port is unchanged: jobs after commit
  (Invariant 7), the templates, five attempts with backoff, the audit note
  per email.
- **`MAILER=cloudflare`** in Dokploy chooses it; `ses` stays selectable and
  configured as a one-value rollback. The compose default stays `ses`, so
  this code deploys safely before the Cloudflare values exist.
- **Our own id per email.** The REST API returns per-recipient status, not
  a message id, and sets `Message-ID` itself. Each send gets a UUID, sent
  as `X-Echoandaura-Id`, logged and written to the order's audit note, so
  one email can be traced from the log to Gmail's "Show original".
- **Errors decide retries:** 429 / code 10004 → `MailerThrottledError`
  (backoff). Codes 10001/10200/10201/10202 (the request itself is wrong) and
  a permanent bounce → `MailerPermanentError` (not retried, recorded on the
  order). Token, permission, account and server errors (401/403/404/5xx)
  and network failures or the 20 s timeout → retryable: a token fixed in
  Dokploy within the retry window still delivers the email.
- **A `queued` result counts as sent**, noted as `(queued)` in the id.
- **Boot checks** like SES's: the account id must be 32 hex characters and
  the token 40+ URL-safe characters, so a placeholder stops the worker
  instead of failing every send.
- **The From display name** goes as `{ address, name }`, parsed from
  `EMAIL_FROM`.

**Consequences:**

- Onboarding adds bounce MX, SPF and DKIM on `cf-bounce.echoandaura.com`;
  the root SPF and the single `_dmarc` record stay ours
  (infra/CLOUDFLARE.md).
- A 5 MiB limit per message: a 10-ticket PDF is ~50 KB.
- New accounts start on an unpublished daily quota that grows with good
  sending. Past it, sends are throttled and retried, never dropped; the
  quota is checked in the dashboard before an on-sale.
- SES is retired (identity, IAM key, DNS records) after a few clean weeks,
  in its own change.

**Rejected:** Resend or Postmark (another vendor and account for the same
job, while the domain, DNS and billing are already on Cloudflare); a
Cloudflare Worker with the email binding (a second deployable, for nothing
the REST call lacks); reopening the SES case (refused twice).
