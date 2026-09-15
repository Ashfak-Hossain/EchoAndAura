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

| Variable                                                                                      | Required | First needed | Purpose                                                              |
| --------------------------------------------------------------------------------------------- | -------- | ------------ | -------------------------------------------------------------------- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`                                         | Yes      | Phase 0      | Credentials for the local Postgres container                         |
| `DATABASE_URL`                                                                                | Yes      | Phase 0      | App's Postgres connection string                                     |
| `TEST_DATABASE_URL`                                                                           | No       | Phase 0      | Isolated DB for the integration suite (falls back to `DATABASE_URL`) |
| `REDIS_URL`                                                                                   | Yes      | Phase 3      | BullMQ queue connection                                              |
| `BETTER_AUTH_SECRET`                                                                          | Yes      | Phase 1      | Signs admin auth sessions                                            |
| `BETTER_AUTH_URL`                                                                             | Yes      | Phase 1      | Base URL for auth callbacks                                          |
| `RESEND_API_KEY`                                                                              | Yes      | Phase 4      | Sends ticket emails                                                  |
| `EMAIL_FROM`                                                                                  | Yes      | Phase 4      | From address (on a verified domain)                                  |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_PUBLIC_URL` | Yes      | Phase 1      | Cloudflare R2 for event images                                       |
| `BKASH_RECEIVE_NUMBER`                                                                        | Yes      | Phase 3      | Organizer's bKash number shown to buyers                             |
| `APP_TIMEZONE`                                                                                | Yes      | —            | App timezone (`Asia/Dhaka`)                                          |

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

### Cloudflare R2 (event images) — Phase 1

1. Cloudflare dashboard → R2 → create a bucket → set `R2_BUCKET`.
2. Copy the account ID → `R2_ACCOUNT_ID`.
3. R2 → Manage API Tokens → create an S3 API token →
   `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`.
4. Enable public access (or attach a custom domain) → `R2_PUBLIC_URL`, the base
   URL images are served from.

### Manual bKash — Phase 3

- `BKASH_RECEIVE_NUMBER`: the organizer's bKash number, shown to buyers on the
  payment page. There is **no bKash API** (see [ADR-001](DECISIONS.md)) — this is
  the only bKash configuration.

### App

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
