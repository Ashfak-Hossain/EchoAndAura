---
description: Prepare the release PR for a version (CHANGELOG + package.json); the owner tags
argument-hint: <x.y.z>
---

Prepare version **$ARGUMENTS** (docs/DEVELOPMENT.md → Releases). Claude
prepares the PR; the owner merges, tags and pushes the tag (ADR-041, ADR-072).

1. Stop unless `$ARGUMENTS` is `X.Y.Z` (no `v`), `vX.Y.Z` does not exist
   (`git tag -l`), and it is the version the `release-manager` agent proposes.
   If the agent proposes another, say why and ask.
2. Branch: `git switch -c release/v$ARGUMENTS --no-track origin/main`.
3. `CHANGELOG.md`: move the `[Unreleased]` entries into a new
   `## [$ARGUMENTS] - <today, Asia/Dhaka>` section under an empty
   `## [Unreleased]`, and add what user-facing PRs since the last tag left
   out. Write for the organizer, in the 1.0.0 section's voice: **For buyers**,
   **For the organizer**, then **Fixes** where there are any. No PR numbers,
   no internal work.
4. `package.json`: `"version": "$ARGUMENTS"`. Nothing else.
5. Check: `node .github/scripts/release-notes.mjs v$ARGUMENTS` prints the
   section, then `pnpm verify`.
6. Hand off as one terminal block: the commit
   (`chore(release): prepare v$ARGUMENTS`), the push, and `gh pr create`
   with the `documentation` label and a Summary and Test plan.
7. Then, for after the merge, the owner's steps in order:
   - wait for that merge's Deploy to go green;
   - `.claude/scripts/check-images.sh <merge sha>` passes (a release PR
     changes `package.json`, so its merge is built);
   - `git switch main && git pull && git tag -a v$ARGUMENTS -m "v$ARGUMENTS" <merge sha> && git push origin v$ARGUMENTS`;
   - after the Release workflow:
     `.claude/scripts/check-images.sh <merge sha> v$ARGUMENTS` and
     `gh release view v$ARGUMENTS`.
