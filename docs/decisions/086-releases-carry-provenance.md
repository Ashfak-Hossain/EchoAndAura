---
id: ADR-086
title: "Each GitHub Release carries its images' signed provenance"
date: 2026-10-26
status: accepted
area: Infrastructure and deploys
supersedes: []
extends: [ADR-075, ADR-082]
---

# ADR-086 — Each GitHub Release carries its images' signed provenance

**Context:** Scorecard's Signed-Releases check (ADR-082) reads the files
attached to the last five GitHub Releases. A release with a
`*.intoto.jsonl` provenance file scores 10. Ours attach no files, so the
check reads "no releases found". The provenance already exists: the
Deploy workflow signs it for every image, by digest (ADR-075), and the
Release workflow verifies it before it names a version. It sits in
GitHub's attestation store, where only `gh` with a GitHub login can
fetch it.

**Decision:**

- **Download first, then verify that file.** In
  [release.yml](../../.github/workflows/release.yml), for each image, the
  workflow downloads its SLSA provenance by digest
  (`gh attestation download --predicate-type https://slsa.dev/provenance/v1`)
  and runs the same strict `gh attestation verify` as before, now with
  `--bundle` pointing at that file. An empty download stops the workflow.
- **Keep only what passed.** The file holds one Sigstore bundle per line
  (a re-run of Deploy adds a line), and verify passes if any one line
  does. So verify writes JSON, and only the bundles it verified go into
  the file that is attached. If none did, the workflow stops.
- **Attach it with the Release.** The files are named
  `echoandaura-<web|worker>-<version>.intoto.jsonl` and go up with
  `gh release create`, the workflow's last step, so no Release is ever
  published without them.
- **Tests:**
  [image-attestations.test.ts](../../tests/unit/image-attestations.test.ts)
  keeps the download by digest and filtered to provenance, the verify on
  that file, the filter to verified bundles, both empty checks, and both
  files on `gh release create` as the last step.

**Rejected:**

- Signing the Release itself (a `.sig` or `.sigstore.json` over a
  checksums file): the Release has no binaries of its own; the images are
  what ships, and their provenance says more than a signature over the
  notes. Signature-only also scores 8, not 10.
- `slsa-github-generator`: a second provenance for the same images, from
  another signer, that the verify step would also have to trust.
- Attaching the SBOMs too: Scorecard doesn't read them, and `gh` already
  fetches them by digest (DEPLOY.md). Easy to add later.
- Adding files to v1.0.0 after the fact: it predates ADR-075, so there
  is no provenance to attach, and Scorecard skips a release without files.

**Consequences:** A Release now depends on `gh attestation download`,
which GitHub still calls a preview. If it changes, the Release workflow
fails before naming any image, and a re-run is safe. Anyone can check an
image against the attached file with `--bundle` (DEPLOY.md → Checking where
an image came from). That check compares the repository only by the name in
the certificate, so the check without `--bundle`, which asks GitHub, stays
the stronger one. The workflow itself loses nothing by using `--bundle`:
its bundles come from this repository's own attestation store, through
`download --repo`. The score moves only with the next tag, which the
owner creates (ADR-074).

**Revisit when:** `gh attestation download` leaves preview or changes its
output, an image gets more provenance than `download` returns by default
(30 attestations, many Deploy re-runs; the release then fails, it doesn't
pass), the Release starts shipping files of its own, or Scorecard changes
which files it reads.
