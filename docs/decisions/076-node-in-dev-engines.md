---
id: ADR-076
title: 'Node 26 is held by devEngines; engines admits Node 24 for Dependabot'
date: 2026-10-15
status: accepted
area: Code structure and tooling
supersedes: []
extends: []
---

# ADR-076 — Node 26 is held by devEngines; engines admits Node 24 for Dependabot

**Context:** The v1.0.0 release set `engines.node` to `>=26 <27`, with
`engineStrict`, so nobody installs on the wrong Node. From that day
Dependabot's npm job failed on every package with
`tool_version_not_supported` (detected `>=26 <27`, supported `v24.21.0`):
its npm updater runs only Node 24 and gives up on a project whose `engines`
leave it out. No weekly update PR opened, and a low katex advisory (through
the docs site's mermaid) went unfixed because the grouped update that would
have bumped mermaid never ran.

**Decision:** Split the two jobs `engines.node` was doing
([package.json](../../package.json)):

- **`devEngines.runtime`** holds people to Node 26:
  `{ "name": "node", "version": ">=26 <27", "onFail": "error" }`. pnpm 11
  checks it on `pnpm install` and on every `pnpm run`, stricter than
  `engines` was (checked on install only).
- **`engines.node`** says `>=24 <27`, so Dependabot's updater can run.
  `engines.pnpm` stays `>=11 <12` under `engineStrict`.
- **A unit test** ([package-manifest.test.ts](../../tests/unit/package-manifest.test.ts))
  keeps both in line with `.nvmrc`: `devEngines` must match it exactly,
  `engines` must run from 24 to the same ceiling.

`.nvmrc`, CI and the Dockerfile still say Node 26. Nothing runs on 24 but
Dependabot's lockfile resolution.

**Rejected:** keeping `engines` strict and bumping packages by hand each
week (the job Dependabot exists for, and security fixes would wait on us);
dropping `engines.node` (then nothing outside `.nvmrc` names a floor);
`onFail: download` (pnpm would fetch a Node behind people's back); Renovate
instead of Dependabot (a new app with repository access, to fix one field).

**Consequences:** pnpm on Node 24 or 25 would accept an install under
`engines`, but `devEngines` refuses it first, so a person still can't. A
tool that reads only `engines` would believe Node 24 is fine; none of ours
does. If Dependabot starts reading `devEngines.runtime` it will fail the
same way again: the job log shows `tool_version_not_supported`. Confirm the
fix after each Dependabot change with "Check for updates" on the npm row
(Insights → Dependency graph → Dependabot).

**Revisit when:** Dependabot's npm updater supports Node 26. Then put
`engines.node` back to `>=26 <27`.
