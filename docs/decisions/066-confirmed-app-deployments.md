---
id: ADR-066
title: Confirm the running web and worker revision after deploying
date: 2026-10-08
status: accepted
area: Infrastructure and deploys
supersedes: []
extends: [ADR-036, ADR-040, ADR-054, ADR-065]
---

# ADR-066 — Confirm the running web and worker revision after deploying

**Context:** Deploy previously finished after Dokploy accepted a request. Images
could still be starting, pinned to an older rollback, or failing their migration.
The future docs-only deployment filter needs a running revision, not the most
recent merge or a successful HTTP request to the deployment API.

**Decision:** D3B1 records the full checked-out Git commit in image-owned,
root-owned `deployment-revision.json` and OCI labels for both runtime images.
The value is not a runtime environment override or the mutable `main` tag.
Each worker queue publishes separate expiring revision evidence at startup and
its existing heartbeat job. Legacy health heartbeats and all business-job
behavior remain unchanged; revision recording is best-effort, never awaited
inside a business job and logs only a fixed warning on failure.

A thin, uncached `/api/deployment` route returns only `{revision, ready}`.
The commit is public repository metadata; no worker identifiers, hosts,
timestamps, keys, settings or error messages are returned. Readiness requires
valid image metadata, healthy database/Redis/legacy worker probes and fresh
matching revision evidence for both expiry and email queues. Missing, future,
malformed or mixed evidence cannot confirm a revision. Probe time is bounded.

The deployment workflow supplies the same full commit to both builds and tests
confirmation on the smoke containers before pushing. After an actual Dokploy
request, a credential-free GET poll waits at most five minutes for that exact
healthy revision. Redirects, cached responses, unexpected shapes and oversized
bodies are refused. Failure is explicit and never prints private response data.
The workflow remains serialized. A missing deployment configuration does not
run confirmation and is not recorded as a confirmed production deployment.

**Rejected:** Latest-commit path filters can miss an earlier failed app release.
A green workflow, image tag, OCI label alone or public health `ok` cannot prove
the exact running pair. A runtime variable could claim a revision without
running its image. Replacing the legacy heartbeat format would complicate
rollback. Shipping credentials to a public confirmation endpoint is unnecessary.

**Consequences:** No database migration, new credential or Dokploy environment
change. Redis gets two temporary records; the app gets a small read-only route.
Local dev and old images without metadata report unknown readiness, not a
fabricated commit. Existing `/api/health` and container liveness stay unchanged.
Rollback pins are respected: an older pinned image must not be called the new
revision, and the workflow does not reset `IMAGE_TAG`, roll back automatically,
or change database state on a confirmation timeout.

This is evidence for the current single-web/single-worker Compose topology,
not cryptographic attestation or proof about all instances of a scaled fleet.
Heartbeat freshness has the existing three-minute tolerance. D3B2's skip policy
remains separate and must consume fresh live evidence conservatively; this
slice still deploys docs-only merges. The first live confirmation remains an
owner-controlled merge/rollout gate, not established by local tests.

**Revisit when:** Multiple application instances, rolling worker pools, a
different deployment platform, or a private revision endpoint is required.
