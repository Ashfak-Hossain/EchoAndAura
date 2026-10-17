---
id: ADR-080
title: 'A dev container: the services share its network, its image and features pinned'
date: 2026-10-17
status: accepted
area: Code structure and tooling
supersedes: []
extends: []
---

# ADR-080 — A dev container: the services share its network, its image and features pinned

**Context:** Setting up locally takes Node 26, pnpm 11 and Docker, then six
commands (README → Getting started). The repository is meant to be a
learning example, and someone reading it should be able to open it in
VS Code or GitHub Codespaces and have it run, without installing a Node
that their other projects don't use. The app reads `.env.example`'s
`localhost` addresses for Postgres, Redis and MinIO.

**Decision:** A dev container in [.devcontainer/](../../.devcontainer/).

- **The same Node and pnpm as production.** Its
  [Dockerfile](../../.devcontainer/Dockerfile) starts from the Node image
  the root Dockerfile builds from, pinned by digest too, and installs the
  pnpm `packageManager` names.
  [devcontainer.test.ts](../../tests/unit/devcontainer.test.ts) fails when
  either drifts, or when the major leaves `.nvmrc`'s.
- **The root compose file, merged.** `devcontainer.json` lists
  `../docker-compose.yml` and [compose.yaml](../../.devcontainer/compose.yaml),
  so the services stay defined once. The overrides put Postgres, Redis and
  MinIO in the dev container's network (`network_mode: service:dev`): they
  answer on `localhost` there, and `.env.example` works unchanged. They
  publish no host port and drop their fixed container names, so the box
  runs beside a stack started on the host. VS Code forwards the app's and
  MinIO's ports and ignores the rest, so Postgres and Redis stay inside. The `dev` service carries the
  name `minio` for the one-shot bucket setup.
- **Linux dependencies in volumes.** `node_modules` and
  `docs-site/node_modules` are volumes, not the host's folders: a macOS
  install holds the wrong esbuild, sharp and SWC binaries. The pnpm store is
  a third, so a rebuild downloads nothing again (it still copies).
- **Set up on create.** `initializeCommand` copies `.env.example` to `.env`
  on the host if there is none (Compose reads it).
  [post-create.sh](../../.devcontainer/post-create.sh) installs, creates the
  integration suite's database and migrates. The admin, the demo data and
  the e2e browsers stay one command each: the first asks for a password,
  the browsers are 400 MB not everyone needs.
- **Pinned features.** git (the OS package) and the GitHub CLI, each at an
  exact version, with `devcontainer-lock.json` holding their digests.
  Dependabot watches the features and the dev image. It cannot see the root
  Dockerfile's Node, an `ARG` default, so that one is bumped by hand in the
  same PR; the test refuses one without the other.
- **No Docker inside.** Nothing in the repository runs `docker` from the
  container, so it gets no socket; Compose is run on the host.
- **Not shipped.** `.dockerignore` keeps `.devcontainer` out of the image
  build, and the deploy selector counts it as non-runtime (ADR-067).

**Rejected:**

- A `compose.yaml` that `include`s the root file: Compose refuses to
  override a service it includes.
- Services on their own network, reached by name: every `localhost` in
  `.env` would need a second set of values, and the docs two versions.
- A ready-made `mcr.microsoft.com/devcontainers/typescript-node` image: it
  trails Node releases, and it is a second Node to keep equal to
  production.
- Installing the e2e browsers on create: slow for everyone, needed by few.
- Docker-in-Docker: a second daemon, and privileged.
- Docker-outside-of-Docker: the host's socket is root on a Linux host (on
  Docker Desktop, its VM), so every install script and dev dependency in
  the container would have it. Nothing here needs it.

**Consequences:** The dev container's user has passwordless sudo inside
the container. That is the usual trade for a dev box, and nothing from it
reaches an image. Its database, Redis and MinIO are its own
volumes, not the host stack's. In Codespaces the app is not on
`localhost`: set `BETTER_AUTH_URL` and `SITE_URL` to the forwarded address
for sign-in, and cover images (`R2_PUBLIC_URL`) load only through a
forwarded port 9000. A Node bump now touches two Dockerfiles; Dependabot
opens it for the dev image only, and the root one is edited by hand.

**Revisit when:** Codespaces or VS Code drop Compose-based dev containers;
the app needs a service the root compose file lacks; the Node image and
the dev image need to differ; or the root Dockerfile names Node in a literal
`FROM`, so Dependabot can bump both.
