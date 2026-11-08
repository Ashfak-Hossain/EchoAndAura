---
id: ADR-090
title: 'Squash merges only: one pull request, one commit on main'
date: 2026-11-08
status: accepted
area: Code structure and tooling
supersedes: [ADR-041]
extends: []
---

# ADR-090 — Squash merges only: one pull request, one commit on main

**Context:** ADR-041 chose merge commits, because that was what the
history already used. In practice each pull request then put three kinds
of commit on `main`: the branch's own work-in-progress commits, a "Merge
pull request #N" commit, and, whenever the branch was behind, the merge
GitHub's **Update branch** button makes. `git log` on main read as noise,
and a line in `git blame` pointed at a "fix review comment" commit instead
of the change it belonged to. The repository has one maintainer and one
pull request open at a time, so the branch's inner history is of no use
to anyone after the merge.

**Decision:**

- **Squash merges only**, from 2026-11-08. The repository setting allows
  only squash, and the "main is production" ruleset enforces it
  (`allowed_merge_methods: ["squash"]` in
  [main-is-production.json](../../ops/github/rulesets/main-is-production.json),
  which `pnpm rulesets:check` compares with GitHub).
- **The pull request title is the commit subject on main.** So it must
  be a Conventional Commit (`type(scope): what it does`). GitHub adds
  ` (#N)` at the end. The PR body (Summary and Test plan) becomes the
  commit message. The [PR template](../../.github/pull_request_template.md)
  says so.
- **Update branch is harmless now.** Its merge commit stays on the
  branch, and the squash folds it away.
- **[git-tidy](../../scripts/git-tidy.sh) recognises a squashed branch.**
  A squash commit is new, so a squashed branch is never an ancestor of
  main, and the ancestry check alone kept every finished branch. A
  branch now also counts as merged when main, since the branch forked,
  has a commit with the same patch-id as the branch's whole change, and
  that commit's files equal the branch's on every path the branch
  changed. patch-id only finds the candidate: it ignores whitespace, so a
  re-indent added after the squash would otherwise look merged and be
  deleted. The check is read-only. The ancestry check stays for branches
  merged before this ADR.

**Rejected:**

- Keeping merge commits: the noise above.
- Rebase merges: GitHub rewrites each commit onto main, so main gets
  commits CI never ran on as they are, one per branch commit. Deploys
  run on every push to main (ADR-036), and a broken middle commit is one
  `git bisect` would land on.
- Allowing all three methods: the history depends on which button was
  clicked, and git-tidy would need to know all three.

**Consequences:**

- A branch's own commits are gone from main. They stay on the closed pull
  request.
- Release notes are not affected, because they come from merged pull
  requests and their labels (`.github/release.yml`). `--first-parent`
  tooling (release-manager, `/event-ready`) still sees one commit per
  pull request.
- git-tidy keeps a branch that got more commits after its squash, and a
  branch whose file main also changed between its last update and the
  squash (the squash's diff then differs from the branch's). It reports
  these instead, and you delete them by hand. Keeping too much is the
  safe side.
- A careless PR title now lands on main as it is, so the reviewer checks
  the title too.

**Revisit when:** a second maintainer joins and wants branch history on
main, or stacked pull requests come back (a squash breaks the branch
stacked on top of it).
