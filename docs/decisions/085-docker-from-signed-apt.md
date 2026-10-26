---
id: ADR-085
title: "Docker from its signed apt repository, before Dokploy's script"
date: 2026-10-26
status: accepted
area: Infrastructure and deploys
supersedes: []
extends: [ADR-063, ADR-084]
---

# ADR-085 — Docker from its signed apt repository, before Dokploy's script

**Context:** After ADR-084, Scorecard's Pinned-Dependencies had one
warning left: Dokploy's install script, which the `dokploy` role runs on a
new server, installs Docker with `curl -sSL https://get.docker.com | sh`.
Nothing checks those bytes, and they run as root. ADR-063 kept the script
exactly as upstream ships it, so the line stayed. Production got Docker
that way on 2026-09-27.

**Decision:**

- **A `docker_engine` role installs Docker first.** In
  [site.yml](../../ops/ansible/site.yml) it runs after `docker_config` and
  `origin_lockdown` (so `daemon.json` and the lockdown are in place at
  Docker's first start, as before) and before `dokploy`. It adds Docker's
  apt repository with `signed-by`, so apt trusts the key for that
  repository only, and installs Docker 28.5.0, held, as the script did.
- **The key is a reviewed file.**
  [docker.asc](../../ops/ansible/roles/docker_engine/files/docker.asc) is
  kept in the repo with its hash in the role's defaults. The role checks the
  hash before it copies the key. It is never downloaded at run time.
  It is the same key `get.docker.com` put on production.
- **One change to Dokploy's script.** Where Docker is missing it now stops
  with an error instead of fetching `get.docker.com`. The change is marked
  in the file, and the script's hash is updated. Unit tests refuse a
  download piped into a shell and check that this branch exits.

**Rejected:**

- Keeping the script unmodified and dismissing the finding: the line still
  runs on any server where Docker is missing, which a later edit to the
  role order could bring back without anyone noticing.
- Downloading the key at run time and checking its fingerprint: the same
  trust, with one more network dependency on rebuild night.
- Installing Docker from Ubuntu's `docker.io` package: a different build
  and version from production's, so a rebuild would not match it.

**Consequences:** ADR-063's "kept unmodified" now means "unmodified but
for ADR-085's change": taking a newer Dokploy script means making the
change again. The repository line and the key are the ones production
already has, so production changes nothing. Docker moves only when
`docker_engine_version` moves; the role installs past its own hold then.
containerd and the buildx and compose plugins are not pinned or held, as
before: a rebuild gets that night's versions, and unattended upgrades
don't touch them (they take Ubuntu's security updates only). If Docker rotates its signing key, apt
stops updating Docker until the new key is reviewed and committed. That is
the intended failure.

**Revisit when:** Dokploy's script stops installing Docker itself, Docker
rotates its apt key, or the server moves off Ubuntu.
