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

| Variable                                                                                    | Required   | First needed | Purpose                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ---------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`                                       | Yes        | Phase 0      | Credentials for the local Postgres container                                                                                           |
| `DATABASE_URL`                                                                              | Yes        | Phase 0      | App's Postgres connection string                                                                                                       |
| `TEST_DATABASE_URL`                                                                         | No         | Phase 0      | Isolated DB for the integration suite (falls back to `DATABASE_URL`)                                                                   |
| `REDIS_URL`                                                                                 | Yes        | Phase 3      | BullMQ queue connection                                                                                                                |
| `BETTER_AUTH_SECRET`                                                                        | Yes        | Phase 1      | Signs admin auth sessions                                                                                                              |
| `BETTER_AUTH_URL`                                                                           | Yes        | Phase 1      | Base URL for auth callbacks                                                                                                            |
| `RESEND_API_KEY`                                                                            | Yes        | Phase 4      | Sends ticket emails                                                                                                                    |
| `EMAIL_FROM`                                                                                | Yes        | Phase 4      | From address (on a verified domain)                                                                                                    |
| `R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_PUBLIC_URL` | Yes        | Phase 1      | S3-compatible object storage for event images: MinIO locally, Cloudflare R2 in production                                              |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`                                                   | Local only | Phase 1      | Credentials for the MinIO container in `docker-compose.yml`; the same values go in `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` locally |
| `BKASH_RECEIVE_NUMBER`                                                                      | Yes        | Phase 3      | Organizer's bKash number shown to buyers                                                                                               |
| `APP_ENV`                                                                                   | No         | Phase 1      | `local` \| `staging` \| `production` — the environment chip in the admin header; falls back to `NODE_ENV`                              |
| `SITE_URL`                                                                                  | Yes (prod) | Phase 2      | Absolute public origin for canonical + Open Graph URLs (`https://echoandaura.com`); falls back to `BETTER_AUTH_URL` locally            |
| `FACEBOOK_PAGE_URL`                                                                         | No         | Phase 2      | Organizer's Facebook page — "Remind me on Facebook" / footer link; hidden when unset                                                   |
| `BKASH_RECEIVE_NUMBER`                                                                      | No         | Phase 3      | Personal bKash number buyers send money to (order page); "to be announced" when unset. Moves to Settings in Phase 6                    |
| `ORGANIZER_CONTACT_EMAIL`                                                                   | No         | Phase 3      | Organizer email shown on order pages ("Stuck? Message the organizer…"); hidden when unset                                              |
| `APP_TIMEZONE`                                                                              | Yes        | —            | App timezone (`Asia/Dhaka`)                                                                                                            |

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

- `BETTER_AUTH_SECRET`: generate a 32-byte random secret —
  `openssl rand -base64 32`. Keep it stable; rotating it invalidates all sessions.
- `BETTER_AUTH_URL`: the app's base URL (`http://localhost:3000` in dev; the real
  domain in production).
- **Create the admin account** (once, after `pnpm db:migrate`):
  `pnpm admin:create <email> <password> [name]`. Public sign-up is disabled, so
  this is the only way an account is created; running it again for the same
  email fails cleanly.

### Resend (email) — Phase 4

1. Create an account at [resend.com](https://resend.com).
2. **Verify a sending domain** (add the DNS records Resend gives you). Sending
   requires this — it is the current project blocker (no domain chosen yet).
3. API Keys → Create → copy into `RESEND_API_KEY` (starts with `re_`).
4. `EMAIL_FROM`: an address on the verified domain, e.g.
   `echoandaura <tickets@yourdomain>`.

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
