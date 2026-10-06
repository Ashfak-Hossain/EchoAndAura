---
id: ADR-041
title: 'The repository: public and proprietary, merge commits, versions as milestones'
date: 2026-09-29
status: accepted
area: Code structure and tooling
supersedes: []
extends: []
---

# ADR-041 — The repository: public and proprietary, merge commits, versions as milestones

**Date:** 2026-09-29 · **Status:** Accepted

**Context:** The repository had drifted from the project:

- no description, license or security policy;
- Dependabot off;
- every merge method allowed;
- a changelog frozen at Phase 0, and a rule to "tag each deploy" that was
  never followed.

Before launch it needed the setup a business's code should have, and
rules that match how the project actually ships.

**Decision:**

- **Public, proprietary.** The repo stays public. On GitHub's free plan
  that is what keeps the "main is production" ruleset, secret-scanning
  push protection and CodeQL enforced, and lets the server pull images
  anonymously. The code is licensed **all rights reserved**: readable,
  not reusable. The copyright holder is the client: Raj Sr, trading as
  Echo & Aura (confirmed 2026-10-02). `SECURITY.md` asks
  for private reports (GitHub advisories or email).
- **One merge method: merge commits,** as the history already is.
  Branches are deleted after merge. The ruleset also requires review
  threads to be resolved.
- **Versions are milestones, not deploys.** Every merge to `main` still
  deploys (ADR-036).
  - A SemVer tag (`v1.0.0` at go-live) runs the Release workflow. It
    re-tags that commit's existing images with the version, without
    rebuilding, so a rollback can pin `IMAGE_TAG=v1.0.0`. It also
    publishes a GitHub Release with notes generated from the merged PRs,
    grouped by label.
  - `CHANGELOG.md` gets an entry per version, written for the organizer.
  - No retroactive tags for the build phases.
- **Dependabot** opens one grouped PR a week for minor and patch bumps
  (npm, Actions, Docker), one PR per major bump, and security fixes as
  they come. Pins stay exact.
- **Contribution scaffolding** sized for one maintainer: `CODEOWNERS`, a
  PR template carrying the invariants checklist, and bug and feature
  issue forms. Blank issues are off, and buyers are pointed to the
  organizer.

**Consequences:** anyone can read the code and the infrastructure notes.
No secret is in them: a PreToolUse hook blocks the project's real secret
formats, and GitHub's push protection is a second lock. A tag must point
at a commit `main` has already built, or the Release workflow fails; it
never builds an image of its own.

**Revisit when:** the code should no longer be readable (then a paid plan
keeps the ruleset, and the server needs a GHCR pull token), or a second
maintainer joins (then required reviews and code-owner review).
