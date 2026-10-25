---
id: ADR-083
title: 'Workflows check out github.sha and grant writes per job'
date: 2026-10-25
status: accepted
area: Infrastructure and deploys
supersedes: []
extends: [ADR-067, ADR-082]
---

# ADR-083 — Workflows check out github.sha and grant writes per job

**Context:** The first published Scorecard (ADR-082) gave 5.0, with 0 on
two checks a workflow edit controls. Dangerous-Workflow (the one critical
check) flagged both Deploy checkouts of
`github.event.workflow_run.head_sha`: a `workflow_run` workflow that
checks out the triggering run's commit is how a fork's pull request
reaches a job with secrets. Ours could not be reached that way (the jobs
run only for a push to main, and only on the commit main is at), but the
pattern scores 0 whatever guards it. Token-Permissions flagged Release's
workflow-level `contents` and `packages` write.

**Decision:**

- **Deploy checks out `github.sha`.** In both jobs of
  [deploy.yml](../../.github/workflows/deploy.yml), the checkout takes no
  `ref`. The images job already ran only when `head_sha == github.sha`, so
  it builds the same commit. The selection job now checks out main as it
  was when the `workflow_run` event fired (`github.sha` is fixed for the
  run, re-runs included), and
  [deploy-select.mjs](../../.github/scripts/deploy-select.mjs) treats a
  candidate that is not that commit as `stale_candidate`: main moved past
  it, and the newer run decides. Before, the same run checked out the
  candidate and stopped on the `origin/main` comparison. The candidate
  is still compared, never checked out or run. A manual run checks out
  the candidate itself, so a mismatch there still fails.
- **Release grants its writes to the job.**
  [release.yml](../../.github/workflows/release.yml) has
  `permissions: {}` at the top; its one job holds `contents: write`,
  `packages: write` and `attestations: read`.
- **A test for every workflow.**
  [workflow-hardening.test.ts](../../tests/unit/workflow-hardening.test.ts)
  refuses a top-level permission above `read`, a checkout `ref` built from
  `github.event` or `github.head_ref`, and an event value expanded inside a
  `run:` script (those go through `env`).

**Rejected:**

- Dismissing the Dangerous-Workflow finding as a false positive: it is
  the heaviest check, and the guards that make it safe live in `if`
  expressions a later edit could loosen without anyone seeing the score
  move.
- Moving the stale check into the workflow's `if`: the selector already
  decides and records every skip, and has the tests.

**Consequences:** No change to what deploys or when. A stale run is
skipped earlier than before, with the same reason. A new workflow must
pass the hardening test, so a write permission has to go on the job that
needs it.

**Revisit when:** Deploy needs to build a commit other than the one main
is at (for example a rollback build), or Scorecard changes how it reads
`workflow_run` checkouts.
