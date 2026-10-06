---
id: ADR-036
title: 'Deployment: Dokploy on one VPS, images built in CI, pull-only deploys'
date: 2026-09-27
status: accepted
area: Infrastructure and deploys
supersedes: []
extends: []
---

# ADR-036 — Deployment: Dokploy on one VPS, images built in CI, pull-only deploys

**Date:** 2026-09-27 · **Status:** Accepted

**Context:** Production is one BengalCloud VPS: 2 vCPU, 4 GB RAM, 25 GB
NVMe, on a BDIX line in Dhaka. The person running it is new to server
work and wants a dashboard for logs, restarts, environment variables and
backups, not only a shell. A Next.js build needs more RAM and disk than
this server should spare while it is serving a sale.

**Decision:**

- **Dokploy** runs the app: a dashboard, Traefik for routing and HTTPS,
  managed Postgres and Redis with scheduled backups to S3-compatible
  storage (R2). Coolify does the same with a heavier footprint; plain
  Compose would leave backups, logs and rollbacks to scripts and SSH.
- **Images are built in GitHub Actions, never on the server.** One
  `Dockerfile`, two targets:
  - `web`: Next's standalone server. It runs as a non-root user, with a
    volume for the image optimizer's cache.
  - `worker`: the BullMQ worker, plus the bundled ops scripts `migrate`,
    `create-admin` and `promote-admin`.

  Standalone output is enabled only by the Dockerfile (`NEXT_OUTPUT`).
  `pnpm start` and Playwright keep `next start`.

- **The deploy chain:** CI passes on a push to `main`, then
  `deploy.yml` builds both images and smoke-tests them against a real
  Postgres and Redis. The smoke test runs every migration from empty,
  checks `/api/health`, `/` and `/door/sw.js`, and checks that the worker
  stays up. The workflow then pushes the images to GHCR as `main` and
  `sha-<commit>`, and calls Dokploy's API. Dokploy pulls the images and
  runs `docker-compose.prod.yml`.
- **Migrations run as a one-shot `migrate` service** from the worker
  image, using drizzle-orm's migrator (production has no drizzle-kit).
  `web` and `worker` start only if it exits 0.
- **Rollback is pinning `IMAGE_TAG=sha-…`** in Dokploy. Migrations are
  never rolled back, so they must stay backward compatible for one
  release: add first, remove later.
- **`/api/health`** reports whether Postgres and Redis answer (200 or 503,
  booleans only), for the uptime monitor. `?live` only proves the process
  answers, and is the container health check. An unhealthy container is
  dropped by Traefik, so a Redis outage must not take down pages that
  could still be served.
- **Secrets per service.** Only the worker gets the SES keys, because the
  web never sends email. Both get the auth settings: the worker runs the
  `create-admin` script, and it already holds the database password, which
  is full control, so withholding the auth secret would protect nothing.
  Every secret is set in Dokploy and kept in Bitwarden, and none is in the
  repo or GitHub. The one value baked into
  the image is `R2_PUBLIC_URL`, which is public (ADR-033).
- **The 25 GB disk.** Container logs are capped at 3 × 10 MB per service,
  images come in pre-built, and old images are pruned (Slice D2).
  Memory limits keep the app from starving Dokploy: web 1 GB, worker
  768 MB. The worker idles at about 300 MB and a ticket PDF render comes
  on top of that; the web idles at about 135 MB (both measured locally).

**Consequences:**

- There is no staging server. The CI smoke test boots the exact
  production images instead, and bigger changes get checked locally with
  the same images (DEPLOY.md).
- A deploy restarts `web`, a few seconds of downtime. That's acceptable
  for one organizer; deploys avoid sale peaks and event nights. It stays
  a few seconds only because the image's health check uses
  `--start-interval=2s`: Traefik routes nothing to a container until it
  reports healthy, and without that the first check waits the full 30 s
  interval.
- The worker image is about 1 GB, because it carries every production
  dependency (Next, the editor, the shadcn CLI) though it needs a few. The
  web image is about 350 MB. Each version kept for a rollback costs that
  much disk.
- The images may be public on GHCR, like the repo. That is safe: no
  secret is in them, and the build fails if a build-time placeholder
  leaks into the output. If they are private, Dokploy pulls them with a
  GitHub token that can only read packages (DEPLOY.md).
- A manual run of the Deploy workflow works only from `main`.
- GHCR and SES are reached over the VPS's international route, so image
  pulls are only as fast as that route.
- `main` can be merged before the server exists: without `R2_PUBLIC_URL`
  (a repo variable) the Deploy workflow skips, and without the Dokploy
  secrets it pushes images but doesn't deploy.

**Found after the first real sales (2026-09-28):** the smoke test boots
the images on an empty database, so it never renders a ticket. The
worker image lacked the PDF fonts (the web image gets them through Next's
file tracing; the worker bundle has none), and a Dokploy Environment still
held placeholder SES keys; both surfaced only at the first real email.
The worker now checks both at boot (fonts readable, SES keys shaped like
keys) and refuses to start otherwise, so the smoke test's "worker stays
up" catches them, and the smoke test uses AWS's documented example keys.

**Revisit when:** the disk or RAM becomes the limit (a bigger plan comes
before any architecture change; trimming the worker image to what it
imports is the first step); zero-downtime deploys matter (two `web`
replicas behind Traefik); or a second organizer or tenant appears.
