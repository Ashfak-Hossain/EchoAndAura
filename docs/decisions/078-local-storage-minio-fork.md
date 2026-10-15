---
id: ADR-078
title: "Local object storage from Pigsty's MinIO fork, pinned by digest"
date: 2026-10-15
status: accepted
area: Code structure and tooling
supersedes: []
extends: []
---

# ADR-078 — Local object storage from Pigsty's MinIO fork, pinned by digest

**Context:** Development and the e2e tests store cover images in MinIO, a
local stand-in for R2 (ADR-007). MinIO archived its open-source edition,
deleted `minio/minio` and `minio/mc` from Docker Hub in September 2026,
and quay.io now refuses anonymous pulls of the tags we pinned. A fresh
`docker compose up` failed, and with it `pnpm db:seed`, the storage
integration test and the cover e2e test. No registry serves those images
any more.

**Decision:** Run Pigsty's fork of the same server
([docker-compose.yml](../../docker-compose.yml)):
`pgsty/silo` for the server and `pgsty/mc` for the one-shot bucket setup,
both `RELEASE.2026-09-16T00-00-00Z`.

- **A drop-in.** It keeps MinIO's `server` command, the `MINIO_ROOT_*`
  variables and the `mc` client inside the server image, so the
  healthcheck, the init script, `.env` and the service names stay as they
  were. Checked locally: healthy, bucket created with public download,
  `tests/integration/storage.test.ts` passes, an anonymous GET returns 200
  and an anonymous PUT 403.
- **Pinned by tag and digest.** The fork is one outside maintainer's, and
  a tag can be pushed again; the digest fixes the exact image. The tag
  stays for people reading it. Dependabot watches the `Dockerfile`, not
  the compose files, so a bump is by hand: both parts together.
- **Local only.** Production uses Cloudflare R2. Nothing in the app
  changes.

**Rejected:**

- Chainguard's MinIO image: maintained, but its free tier offers `latest`
  only, and older digests are not kept, so it can't be pinned for long.
- Garage, SeaweedFS or RustFS: a new config file and init script, and the
  anonymous-read bucket and presigned uploads would need proving again,
  for a store that only serves local tests.
- Building MinIO from source into our own image: a build to maintain for
  a dev dependency.
- Mirroring the old images into GHCR: we have no copy to mirror from.

**Consequences:** We depend on a community fork for local tooling. If it
stops, the pinned digest keeps working until Docker Hub removes it, and
the store can be swapped behind the same S3 settings. A bump of this
image needs the storage test run locally (CI has no object store). The
service is still named `minio`, to keep `.env`, the docs and the e2e
setup unchanged.

**Revisit when:** Pigsty stops publishing; Docker Hub drops the pinned
digest; or CI gains an object store, which could then use the same image.
The fallback for the first two: copy the pinned digest into our own GHCR
now-and-then (`crane copy`), so a fresh pull no longer depends on them.
