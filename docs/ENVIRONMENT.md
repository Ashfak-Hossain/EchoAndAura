# Environment Variables

Status: ACTIVE · Owner: unassigned · Last updated: 2026-09-15

Every variable the app reads — what it's for, whether it's required, and how to
obtain it. Configuration is loaded from `.env` (git-ignored). Copy the committed
template and fill it in:

```bash
cp .env.example .env
```

Never commit real secrets: `.env` is git-ignored (only `.env.example` is
committed) and a Write/Edit hook blocks obvious hardcoded secrets.

## Quick reference

| Variable                                                                                    | Required          | First needed | Purpose                                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | ----------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`                                       | Yes               | Phase 0      | Credentials for the local Postgres container                                                                                                                       |
| `DATABASE_URL`                                                                              | Yes               | Phase 0      | App's Postgres connection string                                                                                                                                   |
| `TEST_DATABASE_URL`                                                                         | No                | Phase 0      | Isolated DB for the integration suite (falls back to `DATABASE_URL`)                                                                                               |
| `REDIS_URL`                                                                                 | Yes               | Phase 3      | BullMQ: the worker consumes; the app enqueues email jobs after each commit (fails fast and logs if Redis is down — the order stands)                               |
| `LOG_LEVEL`                                                                                 | No                | Phase 3      | pino level for services and the worker (default `debug` locally, `info` in production)                                                                             |
| `BETTER_AUTH_SECRET`                                                                        | Yes               | Phase 1      | Signs admin auth sessions                                                                                                                                          |
| `BETTER_AUTH_URL`                                                                           | Yes               | Phase 1      | Base URL for auth callbacks                                                                                                                                        |
| `MAILER`                                                                                    | No                | Phase 4      | `ses` or `log` (default: `ses` in production, `log` elsewhere — writes emails to `tmp/emails/`). The worker refuses to start in production with anything but `ses` |
| `AWS_SES_REGION` / `AWS_SES_ACCESS_KEY_ID` / `AWS_SES_SECRET_ACCESS_KEY`                    | With `MAILER=ses` | Phase 4      | Amazon SES credentials for the worker (IAM user with `ses:SendEmail` only; region `ap-south-1`)                                                                    |
| `EMAIL_FROM`                                                                                | With `MAILER=ses` | Phase 4      | From address on the verified domain, e.g. `echoandaura <tickets@echoandaura.com>`. Keep the display name ASCII (SESv2 envelope)                                    |
| `EMAIL_REPLY_TO`                                                                            | No                | Phase 4      | Where buyer replies land, e.g. `hello@echoandaura.com` (Cloudflare Email Routing → the organizer)                                                                  |
| `ORGANIZER_PHONE`                                                                           | No                | Phase 4      | Organizer phone shown in emails ("Raj 01712 345678"), on /contact and every policy page contact card; hidden when unset                                            |
| `E2E_EXPOSE_MAGIC_LINK`                                                                     | No (tests)        | Phase 4      | `1` makes the sign-in page show the magic link so Playwright can follow it. Honoured only when `APP_ENV=test`; ignored everywhere else                             |
| `R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_PUBLIC_URL` | Yes               | Phase 1      | S3-compatible object storage for event images: MinIO locally, Cloudflare R2 in production                                                                          |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`                                                   | Local only        | Phase 1      | Credentials for the MinIO container in `docker-compose.yml`; the same values go in `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` locally                             |
| `BKASH_RECEIVE_NUMBER`                                                                      | Yes               | Phase 3      | Organizer's bKash number shown to buyers                                                                                                                           |
| `APP_ENV`                                                                                   | No                | Phase 1      | `local` \| `staging` \| `production` — the environment chip in the admin header; falls back to `NODE_ENV`                                                          |
| `SITE_URL`                                                                                  | Yes (prod)        | Phase 2      | Absolute public origin for canonical + Open Graph URLs (`https://echoandaura.com`); falls back to `BETTER_AUTH_URL` locally                                        |
| `FACEBOOK_PAGE_URL`                                                                         | No                | Phase 2      | Organizer's Facebook page — "Remind me on Facebook", footer link, contact cards; hidden when unset                                                                 |
| `BKASH_RECEIVE_NUMBER`                                                                      | No                | Phase 3      | Personal bKash number buyers send money to (order page); "to be announced" when unset. Moves to Settings in Phase 6                                                |
| `ORGANIZER_CONTACT_EMAIL`                                                                   | No                | Phase 3      | Organizer email shown on order pages ("Stuck? Message the organizer…"), on /contact and every policy page contact card; hidden when unset                          |
| `APP_TIMEZONE`                                                                              | Yes               | —            | App timezone (`Asia/Dhaka`)                                                                                                                                        |

## How to obtain / prepare each

### Database (Postgres)

- **Local:** the `docker-compose.yml` Postgres container reads
  `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`. The `.env.example`
  defaults already match, so local dev works out of the box.
- `DATABASE_URL` must point at those values:
  `postgresql://<user>:<password>@localhost:5432/<db>`.
- **Production:** use a managed Postgres (or the VPS container) and set
  `DATABASE_URL` to its connection string.

### Redis

- **Local:** the `docker-compose.yml` Redis container. `REDIS_URL=redis://localhost:6379`.
- **Production:** managed Redis or the VPS container.

### better-auth

Two kinds of user share better-auth: the **admin** (password login at
`/admin/login`, role `admin`) and **buyers** (passwordless: `/account/sign-in`
emails a 15-minute link through the worker; the first sign-in creates the
account, role `buyer`). `users.role` decides who gets past the admin layout.
`pnpm admin:create` sets the role; for an admin created before the role column
existed, run `pnpm admin:promote <email>` once.

- `BETTER_AUTH_SECRET`: generate a 32-byte random secret —
  `openssl rand -base64 32`. Keep it stable; rotating it invalidates all sessions.
- `BETTER_AUTH_URL`: the app's base URL (`http://localhost:3000` in dev; the real
  domain in production).
- **Create the admin account** (once, after `pnpm db:migrate`):
  `pnpm admin:create <email> <password> [name]`. Public sign-up is disabled, so
  this is the only way an account is created; running it again for the same
  email fails cleanly.

### Email — Amazon SES on the Cloudflare domain — Phase 4

Emails are sent by the worker (`pnpm worker`) through Amazon SES, behind a
`Mailer` port. Locally `MAILER=log` writes each email to `tmp/emails/`
instead of sending. Cost at this volume (~1,500/month) is cents; the first
3,000/month are free for a year on a new account.

**AWS side (once):**

1. Create an AWS account. Set a **Budget alert at $1** (Billing → Budgets)
   the same day, so any surprise emails you before it grows.
2. SES (region **`ap-south-1`**, Mumbai) → _Identities_ → _Create identity_ →
   Domain `echoandaura.com`, Easy DKIM. SES shows **3 CNAME records**.
3. IAM → _Users_ → create `echoandaura-worker`, access key only, with this
   inline policy (replace the account id; the ARN comes from the identity page):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["ses:SendEmail", "ses:SendRawEmail"],
         "Resource": "arn:aws:ses:ap-south-1:<account-id>:identity/echoandaura.com"
       }
     ]
   }
   ```
4. SES → _Account dashboard_ → **Request production access**. Until it is
   granted the account is in the _sandbox_: only verified addresses can
   receive, and the limit is 1 message/second (the worker sends ≤ 5/s and
   retries throttling, so nothing is lost either way). Suggested text:
   _"Transactional emails only — payment instructions, ticket delivery
   (PDF attached), rejection and expiry notices — for a single-organizer
   event ticketing site (echoandaura.com), ~1,500 messages/month, sent to
   buyers who registered on the site. Bounces and complaints are handled
   by stopping sends to that address."_ Usually approved within 24 hours.

**Cloudflare DNS (grey cloud / DNS-only for all of these):**

| Type  | Name                  | Value                                                |
| ----- | --------------------- | ---------------------------------------------------- |
| CNAME | `<token1>._domainkey` | `<token1>.dkim.amazonses.com` (×3 from SES)          |
| TXT   | `@`                   | `v=spf1 include:amazonses.com ~all`                  |
| TXT   | `_dmarc`              | `v=DMARC1; p=none; rua=mailto:hello@echoandaura.com` |

The identity shows **Verified** a few minutes after the CNAMEs resolve.
Tighten DMARC to `p=quarantine` after a week of clean reports.

**Receiving `hello@` (free):** Cloudflare → _Email_ → _Email Routing_ →
create `hello@echoandaura.com` → forward to the organizer's Gmail.
Cloudflare adds the root `MX` records itself; they do not conflict with SES
(SES only sends). Set `EMAIL_REPLY_TO=hello@echoandaura.com`.

**Deploying the worker:** `pnpm worker:build` produces `dist/worker.mjs`,
but it is not self-contained — run it from the repository root with `src/`
present (the ticket PDF loads its fonts from `src/server/pdf/fonts`).

**Then in `.env` (worker host):** `MAILER=ses`, `AWS_SES_REGION=ap-south-1`,
the two keys, `EMAIL_FROM="echoandaura <tickets@echoandaura.com>"`,
`EMAIL_REPLY_TO`, `ORGANIZER_PHONE`. Smoke test:
`MAILER=ses pnpm email:test you@example.com`.

### Object storage (event cover images) — Phase 1

The app talks to storage through the S3 API only. Locally that is **MinIO**
(started by `docker compose up`); in production it is **Cloudflare R2**.
Nothing in the code knows which — only the env vars differ.

**Local (MinIO)** — works out of the box with the values in `.env.example`:

```
MINIO_ROOT_USER=minio
MINIO_ROOT_PASSWORD=local_password
R2_ENDPOINT=http://localhost:9000
R2_ACCESS_KEY_ID=minio
R2_SECRET_ACCESS_KEY=local_password
R2_BUCKET=echoandaura
R2_PUBLIC_URL=http://localhost:9000/echoandaura
```

`docker compose up -d --wait` starts MinIO and a one-shot `minio-init` that
creates the bucket and makes objects publicly readable (like an R2 public
bucket). Console: http://localhost:9001. MinIO allows browser uploads from
any origin by default, so no CORS setup is needed locally.

**Production (Cloudflare R2):**

1. Cloudflare dashboard → R2 → create a bucket → `R2_BUCKET`.
2. `R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com` (the account
   ID is on the R2 overview page).
3. R2 → Manage API Tokens → create a token with **Object Read & Write** on
   that bucket → `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`.
4. Bucket → Settings → Public access: enable the `r2.dev` subdomain or attach
   a custom domain → `R2_PUBLIC_URL` is that base URL (no trailing slash).
5. Bucket → Settings → **CORS policy** — the browser PUTs directly to R2, so
   the app origin must be allowed:

   ```json
   [
     {
       "AllowedOrigins": ["https://<your-app-domain>"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["Content-Type", "Content-Length"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

Uploads never pass through the Next.js server: the server presigns a PUT
bound to the validated type and size, the browser uploads, and the server
verifies the stored object before recording its key
(see [DECISIONS.md — ADR-007](DECISIONS.md)).

### Manual bKash — Phase 3

- `BKASH_RECEIVE_NUMBER`: the organizer's bKash number, shown to buyers on the
  payment page. There is **no bKash API** (see [ADR-001](DECISIONS.md)) — this is
  the only bKash configuration.

### Public site — Phase 2

- `SITE_URL`: the real public origin in production. Facebook only accepts
  absolute `og:url` / `og:image`, so this must be right before the first
  share. Locally it falls back to `BETTER_AUTH_URL`.
- `FACEBOOK_PAGE_URL`: optional; the event page offers "Remind me on
  Facebook" / "Tell me about the next show" only when it is set.

### App

- `APP_ENV`: optional. Drives the environment chip in the admin header
  (loud in `production`, where destructive actions live). Unset → `local` in
  dev, `production` when `NODE_ENV=production`.

- `APP_TIMEZONE`: `Asia/Dhaka` — all event and registration times are computed in
  this zone.

## Verifying your setup

```bash
docker compose up -d          # Postgres + Redis
pnpm db:migrate               # applies migrations (needs DATABASE_URL)
pnpm db:seed                  # optional sample data
pnpm dev                      # needs the app vars
```

If a command can't connect, re-check `DATABASE_URL` / `REDIS_URL` against the
running containers (`docker compose ps`).
