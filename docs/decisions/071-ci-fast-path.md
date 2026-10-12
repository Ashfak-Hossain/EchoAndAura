---
id: ADR-071
title: CI runs the app and docs parts only when a change can affect them
date: 2026-10-12
status: accepted
area: Infrastructure and deploys
supersedes: []
extends: [ADR-065, ADR-067]
---

# ADR-071 — CI runs the app and docs parts only when a change can affect them

**Context:** Every PR ran the whole `verify` job, about 4.5 minutes: the app
build, Postgres and Redis, the integration suite, the docs build, a browser
install and the docs browser tests. Many PRs only touch Terraform, Ansible or
repository docs. `verify` is the one required check, so a skipped job would
block merging. The unit tests also read non-app files (the deploy workflow,
the ADR index, the Ansible role, the Dockerfile), so those changes still need
them. The docs publisher (ADR-065) expects one checked export from every
successful CI run and fails without it.

**Decision:** `verify` stays one job. On a **pull request into main**, its first step,
[ci-select.mjs](../../.github/scripts/ci-select.mjs), compares the PR's base
with the merge commit, without rename detection. **A push to main always runs
everything**: deploy (ADR-067) builds and ships after any green main run,
diffing against what runs in production, and the docs publisher publishes from
it. A fast main run right after an untested or failed merge would have shipped
that merge's code without its integration tests, or left a docs change
unpublished.

- **Always:** install, typecheck, lint, unit tests.
- **App part** (app build, Postgres/Redis, migrations, integration tests):
  skipped on a PR only when every changed path is in `docs/`, `docs-site/` (not its
  `package.json`), `ops/ansible/`, `ops/terraform/`, the agent folders,
  `notes/`, root Markdown, `.trivyignore.yaml`, or `.github/` other than CI's
  own workflow and selector.
- **Docs part** (docs verify, browser tests, the export): skipped on a PR only when
  every changed path is in the same set minus `docs-site/`, `docs/decisions/`
  (the docs link ADRs) and the docs workflow and `docs-*` scripts. `src/` and
  `tests/` always build the docs (source excerpts and links).
- **Anything else, an empty diff, or a base it cannot read runs everything.**
  So does a PR into any other branch: changing a PR's base starts no new run,
  and a fast result against another branch must not outlive a retarget.
  Steps skip only on an explicit `false`, so a missing answer runs them.
- **Publisher:** a PR run without the docs part uploads a small
  `docs-unchanged-<run>-<attempt>` marker instead of the export. The publisher
  accepts exactly one of the two from that run, attempt and SHA, the marker
  only from a PR run, and publishes nothing for it. Neither, both, or a marker
  on a main run still fails.

Postgres and Redis move from `services:` (which always start) to containers
started only for the app part. A test keeps CI's parts equal to
`pnpm verify`.

**Rejected:** the fast path on pushes to main (see above; found in review);
a separate integration job (it would need to become a required
check, and a skipped required check blocks merging); GitHub's `paths` filters
(they skip the whole workflow, and the required check with it); skipping the
unit tests too (they check the very files infrastructure PRs change); treating
a missing docs export as "unchanged" (it would hide a broken CI).

**Consequences:** Infrastructure and repository-docs PRs finish in about 1.5
minutes; docs-site and ADR PRs in about 2.5–3. Every main run still takes the
full ~4.5, after merging, when nobody waits on it, and keeps "green main means
the whole tree passed". "App-safe" means a path cannot change whether the app
build or integration tests pass; Tailwind scans the whole repository, so a
docs change can still add a CSS class to the app's output, which main's full
run builds before any deploy. A PR whose later push reverts its docs change
does not rebuild its `pr-N` preview, which keeps the earlier content; a
preview that exposed something by mistake is deleted by hand in Cloudflare
Pages. New top-level paths default to a full run until added to a list.
The lists are code: a wrong "safe" entry would skip a needed check, so changes
to them get the same review as the deploy filter's (ADR-067).

**Revisit when:** a part grows slow enough to split by finer paths, the
required check changes, or tests start reading files outside today's lists.
