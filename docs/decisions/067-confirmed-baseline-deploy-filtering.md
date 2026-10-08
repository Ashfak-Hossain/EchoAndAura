---
id: ADR-067
title: Skip application deploys from a confirmed non-runtime diff
date: 2026-10-08
status: accepted
area: Infrastructure and deploys
supersedes: [ADR-036]
extends: [ADR-065, ADR-066]
---

# ADR-067 — Skip application deploys from a confirmed non-runtime diff

**Context:** The developer site publishes independently, but every green push
to `main` still built two application images, pushed them and restarted the
production app. A last-commit path filter is unsafe: an earlier application
change may never have deployed, followed by a documentation-only merge. D3B1
now exposes the exact healthy web/worker revision, and its first production run
confirmed merge `89f0ac2` before this filter was enabled.

**Decision:** Put a credential-free selection job before the image job. For an
automatic run it reads the strict, uncached `/api/deployment` contract, verifies
that the workflow candidate is the current `main` revision, and compares the
complete Git tree from the confirmed running revision to that candidate. It
skips application images only when every changed path is explicitly known not
to affect either production image:

- documentation and docs-site sources, except `docs-site/package.json`;
- repository tests and agent/editor instructions excluded from the image;
- GitHub workflow/configuration files; and
- the Ansible and Terraform trees already excluded from the Docker context.

Root Markdown files are also non-runtime. Every unknown path and every
application, migration, dependency, Docker, relay or other operations path
selects a normal deployment. Rename detection is disabled for the comparison,
so moving an application file into an allowed directory still exposes its old,
unsafe path as a deletion.

The selection job receives only `contents: read`; package write permission and
deployment secrets remain confined to the image job. Manual runs from `main`
always deploy. If live evidence is unavailable, the current `main` candidate
deploys as before. A stale workflow candidate is skipped because a newer main
run owns the decision. Missing, ahead or divergent confirmed history fails the
selection visibly instead of risking a rollback. The existing serialized image
build, smoke test, Dokploy request and exact post-deployment confirmation remain
unchanged.

**Rejected:** Comparing only the latest commit or pull request (can hide an
older undeployed application change); remembering the last successful workflow
in a GitHub variable (a green request was not proof of what runs); a broad list
of runtime paths (new files would default to an unsafe skip); treating endpoint
failure as docs-only; and changing or clearing a Dokploy rollback pin.

**Consequences:** A docs/infra-only merge can leave `main` newer than the
revision in `/api/deployment`; that is expected because the production image's
inputs did not change. The next application-affecting merge compares from that
older running revision and therefore includes every intervening commit. GitHub
still runs full CI and the separate docs publisher still publishes tested docs.
Uncertain paths cost an unnecessary image build rather than a missed deploy.
An unavailable confirmation endpoint also costs a full deploy, preserving the
pre-filter behavior.

**Revisit when:** Production images consume another repository subtree, the
docs package becomes a runtime dependency, deployment moves away from Git
history, or multiple live revisions make one confirmed baseline insufficient.
