# Deploying

Status: ACTIVE · Last updated: 2026-09-27 · Decision: [ADR-036](DECISIONS.md)

How code gets from a laptop to echoandaura.com, and how to undo it. The
server setup itself (Dokploy, Cloudflare, backups) is in the RUNBOOK once
Slice D2 is done.

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
   exact version.
3. Fix forward on a branch as usual. Once the fix is on `main`, set
   `IMAGE_TAG` back to `main` (or delete it) and deploy.

**Migrations are not rolled back.** An old version runs against the newer
schema, so migrations must stay backward compatible: add columns and
tables freely; remove or rename one only in a later release, after the
code that used it is gone. If a migration itself damaged data, restore
from backup (RUNBOOK) — never hand-edit production.

## Running a script on the server

In Dokploy → the compose app → the **worker** container → **Terminal**:

```sh
node dist/ops/create-admin.mjs raj@example.com 'a-temporary-password' 'Raj'
node dist/ops/promote-admin.mjs someone@example.com
node dist/ops/migrate.mjs      # runs on every deploy anyway
```

Give a temporary password and have Raj change it after signing in.

## One-time setup (Slice D2)

In GitHub → the repo → Settings → Secrets and variables → Actions:

| Kind     | Name                 | Value                                                                     |
| -------- | -------------------- | ------------------------------------------------------------------------- |
| Variable | `R2_PUBLIC_URL`      | The public R2 URL covers are served from — baked into the build (ADR-033) |
| Secret   | `DOKPLOY_URL`        | `https://deploy.echoandaura.com`                                          |
| Secret   | `DOKPLOY_API_KEY`    | Dokploy → Settings → Profile → API keys                                   |
| Secret   | `DOKPLOY_COMPOSE_ID` | The compose app's id (in its URL in Dokploy)                              |

Without `R2_PUBLIC_URL` the Deploy workflow does nothing; without the three
Dokploy secrets it builds and pushes images but does not deploy. So `main`
can be merged before the server exists.

After the first push, check the two packages' visibility (GitHub → your
profile → Packages). The repo is public and nothing secret is in the
images, so a public package is fine and needs nothing more. A private one
needs a key on the server to pull it. In GitHub → Settings → Developer settings → Personal access tokens →
Tokens (classic), create one with **only** `read:packages` and a one-year
expiry. Add it in Dokploy → Settings → Registry (URL `ghcr.io`, your GitHub
username, the token as the password), and keep it in Bitwarden. Dokploy
logs the server's Docker in with it. If the first deploy still fails with
`denied` on the pull, do the same by hand once, over SSH:
`docker login ghcr.io -u <github-username>` and paste the token. It can
read images and nothing else. When it expires, deploys fail at the pull
step and the old version keeps running.

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
