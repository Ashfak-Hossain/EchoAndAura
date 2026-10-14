---
id: ADR-074
title: 'Release tags: only the owner creates them, nobody moves or deletes them'
date: 2026-10-14
status: accepted
area: Code structure and tooling
supersedes: []
extends: [ADR-041]
---

# ADR-074 — Release tags: only the owner creates them, nobody moves or deletes them

**Context:** A version tag (`v1.0.0`) names a commit, and the Release
workflow names that commit's images with it, so a rollback can pin
`IMAGE_TAG=v1.0.0` (ADR-041). If the tag moved, the same version would mean
other code, and the GitHub Release would describe a commit the images were
not built from. Until now only `main` was protected. Anyone with write access
could create, move or delete a `v*` tag. Claude is refused by its hook
(ADR-072); nothing stopped a person or a token.

**Decision:** Two tag rulesets, kept as files in
[`ops/github/rulesets/`](../../ops/github/rulesets/) with "main is
production", applied by the owner with `gh api`:

- **"release tags: owner creates"**: `refs/tags/v*`, rule `creation`,
  bypassed only by the repository admin role (the owner).
- **"release tags never move"**: `refs/tags/v*`, rules `update`, `deletion`
  and `non_fast_forward`, with **no bypass, for admins either**.

They are two rulesets because a bypass covers every rule in its ruleset.
One ruleset with the owner's bypass would let the owner move tags too.

- **A wrong tag is not fixed by moving it.** Release the next patch
  (`v1.0.1`). Deleting a tag means switching "never move" off in Settings,
  on purpose, and back on.
- **`pnpm rulesets:check`** ([rulesets-check.ts](../../scripts/rulesets-check.ts))
  reads the live rulesets and fails on any difference from the files, a live
  ruleset without a file, or a file not applied. A unit test
  ([github-rulesets.test.ts](../../tests/unit/github-rulesets.test.ts)) keeps
  the files to this decision: no bypass on "never move", the right pattern,
  active, the right rules.
- **Recommended, the owner's switch:** GitHub's **immutable releases**
  (Settings → General → Releases). Once a Release is published, its tag and
  assets are locked too. It covers the Release, the rulesets cover the tag
  before and after.

**Rejected:** one ruleset with an admin bypass (see above); the GitHub
provider in Terraform (another admin-scoped token, and ADR-062 covers
Cloudflare and AWS); relying on the rule that tags are the owner's (it
stopped Claude, not a token or a slip); protecting every tag (`refs/tags/*`)
when only versions carry meaning.

**Consequences:** A version always names the same commit and images.
Nobody can delete a tag, the owner included, without first turning a ruleset
off. The admin bypass on "owner creates" covers every credential the owner
holds (the `gh` session, any personal access token), so a leaked owner token
can create a tag; and an admin can switch "never move" off. Neither is
prevented, only seen: `pnpm rulesets:check` reports a disabled or changed
ruleset after the fact. Rulesets cover git tags, not GHCR: anyone with
`packages: write` can still push a new image as `:vX.Y.Z`, even an older
image the Deploy workflow signed, so a valid signature alone doesn't prove
a tag is its version. ADR-075 answers that: the digests listed in the
GitHub Release are what protect a version; compare the tag's digest with
them. The
rulesets live on GitHub, so the files can drift; `pnpm
rulesets:check` is how to tell, and a change is made by editing the file and
applying it with `gh api -X PUT`. On the free plan this protection needs the
repository to stay public (ADR-041).

**Revisit when:** a second maintainer joins (who may create tags), releases
move to a workflow that tags for us, or GitHub's immutable releases also
cover tags without a Release.
