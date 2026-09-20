# Secrets inventory

Status: ACTIVE · Owner: Evan · Last updated: 2026-09-20

Every credential the project depends on, **without a single value**. The
values live in the Bitwarden organization `echoandaura`, collection
`echoandaura-infra` (members: Evan, Raj; 2FA on both). Item names below
are the Bitwarden item names — search for them verbatim.

> Bitwarden is being set up. Until the items exist, values live only in
> the owner's local `.env` and head, which is exactly the state this page
> is meant to end. Mark each row's _In Bitwarden_ column as items land.

Rules:

- Nothing in this repo may contain a value: not `.env.example`, not a
  doc, not a test fixture. `.env` is git-ignored; `git log -S <prefix>`
  before pushing if in doubt.
- A secret is _used by_ exactly the processes listed. If a new process
  needs one, it gets its own credential, not a copy.
- **Blast radius** is what an attacker gets with that one secret and
  nothing else — it decides how fast to rotate.

## Inventory

| Bitwarden item                  | Secret(s)                                            | Used by                          | Where it is deployed                    | Blast radius if leaked                                                              | Rotate                                                                                  | In Bitwarden |
| ------------------------------- | ---------------------------------------------------- | -------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------ |
| `AWS root`                      | root email, password, MFA recovery                   | humans, rarely                   | nowhere                                 | the whole AWS account (and its card)                                                | root → Security credentials                                                             | ☐            |
| `AWS ash-admin`                 | console password, MFA                                | Evan                             | nowhere (console + `aws login` session) | full admin of the AWS account                                                       | IAM → user → Security credentials → console password                                    | ☐            |
| `AWS worker key (SES)`          | `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY` | worker process                   | worker host `.env`, dev `.env`          | can send email as `echoandaura.com` (spam/phishing risk, reputation) — nothing else | [AWS.md → Rotate the worker key](AWS.md#rotate-the-worker-key)                          | ☐            |
| `Cloudflare`                    | account login, 2FA backup codes                      | Evan                             | nowhere                                 | DNS (could redirect the site and mail), Email Routing, R2, the domain itself        | Cloudflare → My profile → Authentication                                                | ☐            |
| `Cloudflare R2 token`           | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`           | Next app (presigning)            | app host `.env`                         | read/write the media bucket (cover images only, no PII)                             | [CLOUDFLARE.md → Rotate the R2 token](CLOUDFLARE.md#rotate-the-r2-token-once-r2-exists) | ☐ (Phase 6)  |
| `BETTER_AUTH_SECRET (prod)`     | `BETTER_AUTH_SECRET`                                 | Next app                         | app host `.env`                         | forge any session incl. admin → approve orders, read every buyer's details          | `openssl rand -base64 32`, replace, restart — **signs everyone out**                    | ☐ (Phase 6)  |
| `Postgres (prod)`               | `DATABASE_URL`                                       | Next app, worker                 | app + worker host `.env`                | all data: orders, buyer PII, trxIDs, admin password hashes                          | change the DB user's password, update both `.env`, restart both                         | ☐ (Phase 6)  |
| `Redis (prod)`                  | `REDIS_URL`                                          | Next app, worker                 | app + worker host `.env`                | queue contents (order ids, one-time sign-in URLs for ≤15 min), rate-limit counters  | change Redis password, update both, restart both                                        | ☐ (Phase 6)  |
| `Admin login (echoandaura app)` | `/admin/login` email + password                      | Raj, Evan                        | —                                       | approve/reject orders, edit events, see buyer PII                                   | admin → (Phase 6 Settings) or `pnpm admin:create` a new user and delete the old         | ☐            |
| `bKash receiving number`        | `BKASH_RECEIVE_NUMBER` + whose account               | Next app (shown to buyers)       | app host `.env`                         | not secret (buyers see it) — stored so the number's owner is on record              | edit `.env` / Settings                                                                  | ☐            |
| `Organizer contact`             | `ORGANIZER_CONTACT_EMAIL`, `ORGANIZER_PHONE`         | Next app, worker (emails, pages) | app + worker host `.env`                | public information                                                                  | edit `.env` on both hosts, restart both                                                 | ☐            |

Not secret but kept out of this public repo: the AWS account id
(`AWS_ACCOUNT_ID` in `.env`, Bitwarden `AWS ash-admin`) and the SES
production-access support case id (Bitwarden `AWS ash-admin`, notes).

## Local development

`.env` on a developer machine holds real values for `AWS_SES_*` only if
that developer needs to send real email (`MAILER=ses`); the default is
`MAILER=log`, which needs no AWS credentials at all. Everything else local
is the docker-compose defaults from `.env.example`.

## If something leaks

1. Rotate it (column above) — first deactivate, then replace, then delete.
2. Check what it could have done: SES sending statistics for the worker
   key; `order_events` and the admin audit trail for an app session;
   Cloudflare audit log (account → Manage account → Audit log) for DNS.
3. Search git history: `git log --all -S '<first 8 chars>'`. If it was
   ever committed, it is public even after a force-push — rotate anyway.
4. Note it in this file's history.

## History

| Date       | Change                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-20 | Inventory written. Admin access key that had been created on `ash-admin` deleted the same day, never committed; worker key created |
