---
id: ADR-075
title: Every production image carries signed provenance and an SBOM
date: 2026-10-14
status: accepted
area: Infrastructure and deploys
supersedes: []
extends: [ADR-069, ADR-074]
---

# ADR-075 — Every production image carries signed provenance and an SBOM

**Context:** The production images are public on GHCR, named by tags
(`sha-abc1234`, `main`, `v1.0.0`). A tag on GHCR is a pointer: anything
holding `packages: write` can push a different image under the same name,
and the tag rulesets (ADR-074) only cover git tags. Nothing recorded which
workflow, run and commit built an image, so a rollback to `IMAGE_TAG=v1.0.0`
trusted whatever the tag pointed to that day. Nor was there a list of what
an image contains: the scan (ADR-069) checked it and threw the list away.

**Decision:** The Deploy workflow
([deploy.yml](../../.github/workflows/deploy.yml)) signs two attestations
for each image it pushes, and the Release workflow
([release.yml](../../.github/workflows/release.yml)) checks one before it
gives an image a version.

- **SBOM.** The scan step already exports each image for Trivy. The same
  pinned Trivy container writes an SPDX SBOM from that export, so the list
  is of exactly the image that was scanned and pushed. No new tool.
- **Digests.** The job takes each image's digest from its push and fails
  unless the tag still resolves to that digest on GHCR, so it never signs
  an image something else pushed in between. A digest names one image
  forever.
- **The right commit.** The provenance names `github.sha`. On a
  `workflow_run` that is main's newest commit when CI finished, which is
  not always the commit CI passed. The selector already skips a run main
  has moved past; the `images` job repeats that condition, so the commit
  in the provenance is always the commit built.
- **A separate `attest` job signs.** It holds only `id-token: write` and
  `attestations: write`, runs no shell, and uses only `actions/attest` and
  `actions/download-artifact`, pinned by SHA (ADR-073). It signs SLSA build
  provenance and the SBOM for web and worker, by digest, with GitHub's
  Sigstore (public repositories). The signing token never shares a runner
  with the build, the scanner, or the Sentry and deploy secrets. The
  attestations live in GitHub's attestation store, not on GHCR: the job has
  no `packages: write`. It runs whenever an image was pushed, even if a
  later step failed, and signs each image on its own digest (the SBOMs are
  uploaded before the push), so a failed second push still leaves the
  first image signed and no pushed image goes unsigned.
- **A version needs provenance.** The Release workflow resolves
  `sha-abc1234` to a digest once and runs `gh attestation verify` on it
  with the exact signer identity: this repository's `deploy.yml` at
  `refs/heads/main`, on GitHub's runners (`--cert-identity`,
  `--deny-self-hosted-runners`). `--signer-workflow` alone would accept
  the workflow run from any branch. The provenance itself must name `main`
  and the tagged commit (`--source-ref`, `--source-digest`), and the
  image's `org.opencontainers.image.revision` label must equal that commit
  too (the short `sha-` tag could collide). Both images must pass before
  either is named; `vX.Y.Z` is named from the digest, not the tag. The
  digests are listed in the GitHub Release.
- **Anyone can check an image** with `gh attestation verify` and the same
  signer identity (DEPLOY.md → Checking where an image came from). Rolling
  back does this before pinning a version.

**Rejected:** BuildKit's own attestations (`provenance: mode=max`,
`sbom: true` on build-push-action). They are not signed, so they prove
nothing about who built the image, and the images are built with
`load: true` (scanned and smoke-tested before any push), which keeps
BuildKit's attestations off the image anyway.
Signing with cosign and pushing signatures to GHCR (another tool to pin and
keep current; `gh attestation verify` does the same with GitHub's
Sigstore). Signing inside the `images` job (the OIDC token would be
available to every step there, including the build and the smoke test).
Attesting from the Release workflow (the release runs on images built
earlier; the provenance must come from the run that built them).

**Consequences:**

- The images built before this change, v1.0.0's included, have no
  attestations. The next version is the first a release can verify, and an
  older `sha-` tag can't be released.
- A failed attestation turns the Deploy run red but does not undo a deploy
  already requested; the next release of that commit would fail.
- Provenance says which workflow built an image from which commit. It
  does not make the code safe: a bad merge still produces a properly signed
  image. And it is only as trustworthy as the `images` job: the signer
  takes that job's digests and SBOMs on trust, so a compromised build step
  or action there would be signed as faithfully as a clean one.
- A valid signature doesn't prove a tag is the version it claims: an older
  signed image can be pushed over `:vX.Y.Z`. The digests in the GitHub
  Release are what pin a version.
- The SBOM's predicate type follows the SPDX version the pinned Trivy
  writes (2.3 today); a Trivy bump can change the type a reader asks for.
- `IMAGE_TAG` is one variable for both images, so a rollback still pins by
  tag. Verifying the tag first, and comparing its digest with the Release,
  is the check.
- Each Deploy run keeps the two SBOMs as an artifact for 90 days.

**Revisit when:** Dokploy (or the compose file) can pin web and worker by
digest separately; GitHub's immutable releases can cover container images;
or the repository goes private (attestations then need Enterprise Cloud).
