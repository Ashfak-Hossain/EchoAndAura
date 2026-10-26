---
id: ADR-084
title: 'Build tools installed by hash; the decoder .wasm built from the lockfile'
date: 2026-10-26
status: accepted
area: Infrastructure and deploys
supersedes: []
extends: [ADR-030, ADR-081, ADR-082]
---

# ADR-084 — Build tools installed by hash; the decoder .wasm built from the lockfile

**Context:** Scorecard (ADR-082) scored Pinned-Dependencies 8 and
Binary-Artifacts 9. Three installs named an exact version but not a hash.
Two were `npm install -g pnpm@11.9.0`, in both Dockerfiles; the third was
`npm install wrangler@4.147.0`, which installs the docs uploader. A version
on the registry can't be republished, but a mirror, a proxy or a takeover
could serve other bytes under it. The door scanner's `zxing_reader.wasm`
was committed under `public/vendor/`, a 1 MB binary nobody can read in a
diff. It was the same file `zxing-wasm` ships, kept equal by a test.

**Decision:**

- **pnpm from its tarball.** pnpm has no dependencies, so its registry
  tarball is the whole tool. Both
  [Dockerfiles](../../Dockerfile) `ADD --checksum=sha256:…` it, so BuildKit
  refuses other bytes before anything runs them. They unpack it where
  `npm install -g` put it. `packageManager` in
  [package.json](../../package.json) carries the sha512 npm publishes.
  Tests keep the version equal to `packageManager`, the two Dockerfile
  blocks the same, and no `npm install` in either file.
- **The docs uploader from a lockfile.**
  [.github/docs-tools/](../../.github/docs-tools/package.json) holds a
  `package.json` and a `package-lock.json` for wrangler. Docs-deploy copies
  both from main's checkout and runs `npm ci`, which checks every package
  against the lock's hash. It still never installs from the artifact or a
  PR (ADR-065). Dependabot updates that directory in the same group as the
  root, so the uploader moves with the app's wrangler.
- **The .wasm is built, not committed.**
  [vendor-wasm.mjs](../../scripts/vendor-wasm.mjs) (`pnpm vendor:build`,
  run by `pnpm build` and `pnpm dev`) copies the `.wasm` out of the
  `zxing-wasm` that barcode-detector runs. It writes the file to
  `public/vendor/zxing_reader-<version>.wasm`, now git-ignored, and refuses a
  file whose SHA-256 is not the one the package publishes. The bytes come
  through the lockfile, checked by hash on install. It is still served from
  our origin (ADR-030); only where the file comes from changes.

**Rejected:**

- `npm install -g ./pnpm.tgz` after a manual hash check: Scorecard still
  counts any `npm install` as unpinned, and BuildKit's checksum does the same
  check without a script.
- Corepack: Node 25 and later don't ship it.
- Installing wrangler through the root pnpm lockfile: docs-deploy must not
  install the whole app's dependencies, or anything from the PR tree.
- Dismissing the binary finding: a reviewer can't see what changed in a
  `.wasm`, while a version bump in the lockfile is readable.

**Consequences:** Moving pnpm means a new tarball hash in both Dockerfiles
and the sha512 in `packageManager` (DEVELOPMENT.md → Dependencies). A fresh
clone needs `pnpm dev` or `pnpm build` before `/door` can decode. npm
doesn't read `pnpm-workspace.yaml`, so the uploader's lockfile repeats the
root's audit overrides that reach its tree (`sharp`, `undici`); a test keeps
them equal. CI still gets pnpm from `pnpm/action-setup`, which reads the
version from `packageManager`. The action is pinned by SHA (ADR-073) and
Scorecard doesn't flag it, but its install is not the hash-checked tarball
the images use. The
Dokploy installer still pipes `get.docker.com` into a shell on a new server.
That is Dokploy's own script, kept unmodified (ADR-063), and Scorecard still
flags it. Clearing it means Ansible installs Docker first, a separate change
tested on the lab VM.

**Revisit when:** pnpm gains dependencies, Node ships a package-manager
installer that checks hashes, or the scanner's decoder stops being a
`zxing-wasm` file.
