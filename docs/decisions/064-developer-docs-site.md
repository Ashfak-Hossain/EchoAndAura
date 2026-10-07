---
id: ADR-064
title: 'Developer docs: static Fumadocs, source-linked learning, and selective interaction'
date: 2026-10-07
status: accepted
area: Code structure and tooling
supersedes: []
extends: []
---

# ADR-064 — Developer docs: static Fumadocs, source-linked learning, and selective interaction

**Context:** The repository contains implementation records and operational
instructions, but a developer learning the system needs a reading path:
what happens, why it works, where the code lives, and which test checks it.
The owner wants the clarity of high-quality reference documentation with
colorful architecture diagrams and selected interactive explanations.

**Decision:** Build `docs.echoandaura.com` with Fumadocs and Next.js static
export, as a separate `docs-site/` package in this repository's pnpm workspace.
Cloudflare Pages serves the static output. This decision establishes the
direction; the package and deployment arrive in later slices described in
[the design](../systems/DOCS_SITE.md).

- Reference documentation is the foundation. Tours and concepts connect
  explanations to actual source, tests, and canonical ADRs.
- Use selected build-time source excerpts and revision-pinned source links.
  Type-aware teaching examples may use Twoslash; illustrative examples are
  labeled and do not become another implementation of application logic.
- Add browser-only interactive explanations where timing, state, or competing
  actions benefit from exploration. Every concept has a written explanation,
  and controls work by keyboard and with reduced motion.
- Use a consistent visual language across diagrams. Mermaid is suitable for
  behavior diagrams; architecture posters may use editable SVG and vendor
  icons. The poster authoring tool remains subject to visual comparison.
- Author public content explicitly. Operational records, production runbooks,
  server details, secrets, and personal notes are outside the site's content
  and search collection. Existing repository access is unchanged.
- Search is computed in the browser from a build-time index. The docs build
  needs no application database or production environment values.
- English first. The repository's proprietary license remains in effect.

**Rejected:** Automatically publishing the whole `docs/` directory (different
audiences and operational detail); a runtime docs server on the VPS (static
pages and local interactions meet the current need); using Mermaid for every
illustration (precise architecture layouts need more control); making every
page interactive (higher maintenance without a learning benefit).

**Consequences:** Docs get their own package checks and deployment. Source
excerpts, links, and rendered diagrams must be checked as code changes. A
simulation needs review against the service and its tests; it cannot serve as
proof of database correctness. Multiple visual sources share one publication
and accessibility standard. The first isolated build proves basic static
Fumadocs and Twoslash feasibility, while the design records further acceptance
checks and implementation boundaries.

**Revisit when:** Static search becomes too large, a justified feature needs a
server, the content needs translation, or keeping diagrams and source examples
accurate becomes costly. Reconsider hosting at that point rather than adding
an unreviewed runtime dependency.
