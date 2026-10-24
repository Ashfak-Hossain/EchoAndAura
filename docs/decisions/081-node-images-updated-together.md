---
id: ADR-081
title: 'Node images pinned by digest and updated together'
date: 2026-10-25
status: accepted
area: Code structure and tooling
supersedes: [ADR-080]
extends: []
---

# ADR-081 — Node images pinned by digest and updated together

**Context:** ADR-080 kept the dev container on the same Node version as
production, checked by a unit test. Dependabot could update only the dev
image: the root Dockerfile hid its Node reference in an `ARG`. PR #118
bumped the dev image alone and failed that test. The root image also had
only a version tag, which could resolve to different contents later.

**Decision:** Use literal Node tag-and-digest references in both
[Dockerfiles](../../Dockerfile), including the
[dev container](../../.devcontainer/Dockerfile). A `node` group in
[dependabot.yml](../../.github/dependabot.yml) updates these references
across both directories in one PR. The dev-container test compares the
whole image reference, including the digest.

The production Dockerfile has two Node stages: `base` installs pnpm for
the build, and `runtime-base` starts from the same Node image without
inheriting that tooling. The latter removes npm and Corepack; both `web`
and `worker` inherit it. The existing non-root users, health check and
runtime files stay the same.

This replaces only ADR-080's manual production-Node update rule. Its
network, volume, feature and setup decisions still stand.

**Rejected:**

- Removing the version-match test: it would hide the drift instead of
  letting Dependabot keep the images together.
- Keeping the `ARG` and updating production by hand: the same incomplete
  PR would recur on every dev-container Node update.
- Deriving the runtimes from the build base: it would ship pnpm and its
  dependencies in images that only run Node.

**Consequences:** The root Dockerfile repeats the literal reference for
the build and runtime stages so Dependabot can discover both. Tests
refuse different references or a runtime derived from the build base.
Every Node update needs production image builds and a dev-container
smoke test. Changing the digest deliberately adopts new image contents;
it is reviewed with the version change, not resolved at build time.

**Revisit when:** Development needs a different Node image from
production, or Dependabot can group updates to image references held in
build arguments.
