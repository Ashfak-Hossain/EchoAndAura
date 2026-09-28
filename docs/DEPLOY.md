# Deploying

Status: ACTIVE · Last updated: 2026-09-27 · Decision: [ADR-036](DECISIONS.md)

How code gets from a laptop to echoandaura.com, and how to undo it. The
server itself (Dokploy, backups, disk, monitoring) is recorded in
[infra/SERVER.md](infra/SERVER.md). What to do when something breaks is in
[RUNBOOK.md](RUNBOOK.md).

---

## The short version

```
branch → PR → CI green → merge to main → (automatic) images built → deployed
```

- **`main` is production.** Whatever is merged there goes live within a few
  minutes. Work on a branch; merge only when CI is green.
- **Never edit code on the server**, and never change the production
  database by hand. Schema changes are Drizzle migrations
  (`pnpm db:generate`), committed with the code that needs them; they run
  on their own at deploy.
- **Dev is your laptop** (`pnpm dev`, local Postgres/Redis/MinIO, `.env`).
  There is no staging server: the disk is too small for two copies, and the
  CI smoke test boots the exact production images first.

## What happens on a merge to main

1. **CI** (`.github/workflows/ci.yml`): `pnpm verify`, then the Postgres
   integration tests (the inventory race included). Red stops everything.
2. **Deploy** (`.github/workflows/deploy.yml`), only after a green CI run
   of a push to `main`:
   1. builds two images from the `Dockerfile` on GitHub's machines —
      `echoandaura-web` (the site) and `echoandaura-worker` (emails, hold
      expiry, and the migrate/admin scripts);
   2. **smoke-tests them**: every migration on an empty database, the site
      answering `/api/health` and `/`, the worker staying up;
   3. pushes them to GHCR (GitHub's container registry) tagged `main` and
      `sha-<commit>`;
   4. calls Dokploy, which pulls the new images and runs
      `docker-compose.prod.yml`:
      **migrate** first; **web** and **worker** start only if it succeeded.
3. The site is down for a few seconds while `web` restarts (until its
   health check passes; the image checks every 2 s while booting). Deploy outside
   the busy hours of a sale, and never on event night unless something is
   broken.

A failed migration leaves the old version running: nothing new starts.

## Rolling back

The app, in Dokploy → the compose app → **Environment**:

1. Find the last good version: GitHub → Actions → Deploy → the last green
   run before the bad one. Its summary says `Deploy of sha-abc1234`.
2. Set `IMAGE_TAG=sha-abc1234` and click **Deploy**. Dokploy pulls that
   exact version. A released version works too: `IMAGE_TAG=v1.0.0`
   (DEVELOPMENT.md → Releases).
3. Fix forward on a branch as usual. Once the fix is on `main`, set
   `IMAGE_TAG` back to `main` (or delete it) and deploy.

**Migrations are not rolled back.** An old version runs against the newer
schema, so migrations must stay backward compatible: add columns and
tables freely; remove or rename one only in a later release, after the
code that used it is gone. If a migration itself damaged data, restore
from backup ([RUNBOOK.md](RUNBOOK.md#restore-from-backup)) — never hand-edit production.

## Running a script on the server

In Dokploy → the compose app → the **worker** container → **Terminal**:

```sh
node dist/ops/create-admin.mjs raj@example.com 'a-password-of-12-or-more' 'Raj'
node dist/ops/promote-admin.mjs someone@example.com
node dist/ops/migrate.mjs      # runs on every deploy anyway
```

### Creating an admin account and handing it over

1. Generate the password in Bitwarden (20 characters or more; the
   minimum is 12) and create the account with `create-admin` as above.
2. Share the Bitwarden item with the person. Never send a password by
   chat, SMS or email.
3. They sign in at `/admin/login` and change it at **Your account**
   (`/admin/account`) whenever they like. That also signs out every other
   device.

A forgotten password is reset by the person themselves: **Forgot
password?** on the sign-in page emails a link, valid for an hour. An
admin can also move the account to a new email at **Your account**: the
new address must confirm, and the old one gets a notice (ADR-038). While
SES is in the sandbox, these emails reach only verified addresses
(docs/infra/AWS.md).

## One-time setup (Slice D2)

In GitHub → the repo → Settings → Secrets and variables → Actions:

| Kind     | Name                 | Value                                                                          |
| -------- | -------------------- | ------------------------------------------------------------------------------ |
| Variable | `R2_PUBLIC_URL`      | `https://media.echoandaura.com`: baked into the build (ADR-033)                |
| Secret   | `DOKPLOY_URL`        | `https://deploy.echoandaura.com`                                               |
| Secret   | `DOKPLOY_API_KEY`    | Dokploy → Settings → Profile → API / CLI (Bitwarden `Dokploy deploy (GitHub)`) |
| Secret   | `DOKPLOY_COMPOSE_ID` | The compose app's id (in its URL in Dokploy)                                   |

Without `R2_PUBLIC_URL` the Deploy workflow does nothing; without the three
Dokploy secrets it builds and pushes images but does not deploy. So `main`
can be merged before the server exists. All four were set on 2026-09-27.

**`main` is protected** by the ruleset "main is production" (Settings →
Rules → Rulesets), created 2026-09-27: no deleting it, no force-pushing,
changes only through a pull request (no approval needed: one maintainer),
and CI's `verify` check must pass before the merge button works. There is
no bypass, for admins either.

The two packages on GHCR are **public** (checked 2026-09-27: anonymous
pull works), so the server pulls them with no key. That is safe: the
repo is public too, and no secret is in the images (the build fails if a
placeholder leaks into the output). If they ever become private, the
server needs a read-only key: GitHub → Settings → Developer settings →
Personal access tokens → Tokens (classic), **only** `read:packages`, one
year; add it in Dokploy → Settings → Registry (`ghcr.io`, your GitHub
username, the token as password), or once over SSH with
`docker login ghcr.io -u <github-username>`. Keep it in Bitwarden.

The runtime environment (database, Redis, R2, SES, auth secret) is set in
Dokploy, never in GitHub or the repo: `docker-compose.prod.yml` lists every
variable each service needs, and [ENVIRONMENT.md](ENVIRONMENT.md) says what
each one is. The values live in Bitwarden.

## Checking an image locally

```sh
docker build --target web --build-arg R2_PUBLIC_URL=http://localhost:9000/echoandaura -t echoandaura-web:local .
docker build --target worker --build-arg R2_PUBLIC_URL=http://localhost:9000/echoandaura -t echoandaura-worker:local .
```

Both need `R2_PUBLIC_URL`: they share one build stage, and with the same
value the second build reuses the first one's work (about a minute instead
of three).

Then run them against the local Postgres and Redis with an env file (see
the Smoke test step in `deploy.yml` for the minimum set).
