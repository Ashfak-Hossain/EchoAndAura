---
id: ADR-087
title: 'Open source under AGPL-3.0; the name, the logo and event content left out'
date: 2026-10-26
status: accepted
area: Code structure and tooling
supersedes: [ADR-041, ADR-064]
extends: [ADR-067, ADR-082]
---

# ADR-087 — Open source under AGPL-3.0; the name, the logo and event content left out

**Context:** ADR-041 made the repository public but all rights reserved:
anyone could read the code, but nobody could reuse it. The next steps in
the Scorecard work (ADR-082) need a free software licence. The OpenSSF Best
Practices badge cannot pass without one: `floss_license` is one of its
required (MUST) criteria. Scorecard's License check also stops at 9 for a
licence that isn't OSI- or FSF-approved. The developer wrote the code for
the client under an agreement that assigns its copyright to the client;
ADR-041 records the client as the holder. The holder, Raj Sr (trading as
Echo & Aura), agreed on 2026-10-26 to the AGPL-3.0, provided the name, the
logo, the event content and the photos stay Raj's.

**Decision:**

- **AGPL-3.0-only.** [LICENSE](../../LICENSE) is the licence text as the FSF
  publishes it, with nothing added, so GitHub and Scorecard detect it.
  [package.json](../../package.json) says `AGPL-3.0-only`. It is the
  version 3 licence only, so a later version can't change the terms
  without the holder.
- **The brand is not licensed.** [TRADEMARKS.md](../../TRADEMARKS.md) sits
  beside LICENSE, not inside it. It names what the licence leaves out:
  - the name: no trademark rights, as AGPL section 7(e) allows;
  - the mark and wordmark in `src/lib/brand/marks.ts`, the files rendered
    from it, and `docs/BRAND.md`;
  - event content and photos, which live in production, not in the
    repository.

  Exact copies may be passed on with them. Anyone who runs the software
  for other people, changed or not, must use their own name and marks:
  an unchanged image run elsewhere as "Echo & Aura" would be a fake ticket
  site taking bKash payments.

- **The images carry the licence.** A public GHCR image conveys the
  program, so both runtime stages of the [Dockerfile](../../Dockerfile)
  copy LICENSE and TRADEMARKS.md into `/app` and carry an
  `org.opencontainers.image.licenses` label. Their existing `source`
  label already says where the source is. Because TRADEMARKS.md is in the
  images, the deploy selector counts it as a runtime file: it is the one
  root Markdown file ADR-067 doesn't skip, and a test checks every file
  the images copy from the build context.
- **Outside pull requests stay closed** ([CONTRIBUTING.md](../../CONTRIBUTING.md)).
  The reason changes: before, the licence meant no merge of code we didn't
  own. Now one maintainer reviews everything, and the copyright stays with
  a single holder. Anyone may keep a change in a fork.
- **The docs site** (`docs-site/`) is under the same licence. Its icon
  and logo data are brand files, listed in TRADEMARKS.md.
- **Tests:** [package-manifest.test.ts](../../tests/unit/package-manifest.test.ts)
  checks that both package.json files, LICENSE (by the FSF text's hash),
  TRADEMARKS.md (and that every path it lists exists) and both image
  stages give the same licence.
  [deployment-select.test.ts](../../tests/unit/deployment-select.test.ts)
  checks the selector against the images' copied files.

**Rejected:**

- MIT or Apache-2.0: someone could run a changed copy as a closed hosted
  service. The AGPL's network clause (section 13) asks them to offer its
  source.
- GPL-3.0: it has no network clause, and this program only ever runs as a
  website.
- Putting the brand terms inside LICENSE: GitHub and Scorecard detect a
  licence by matching its text, and an added paragraph can stop the match.
- An SPDX header in every source file, or the REUSE layout: hundreds of
  files changed for no reader's benefit today. They can come later.
- Accepting outside PRs with a DCO sign-off: each contributor would keep
  their own copyright, so relicensing later would need every one of them.

**Consequences:** Anyone may now run, change and share the code. Whoever
runs a changed version for others over a network must offer those users its
source, under their own name and marks. A licence binds the people it is
granted to, not the holder, so while all of the code is Raj's (no outside
contributions merged) the live site needs no "source" link. Adding
one is optional and left for later. While Raj holds every copyright, the
licence of future versions can still change; what was published under AGPL
stays available under it. A new dependency must have a licence compatible
with AGPL-3.0; nothing in CI checks that yet, so the reviewer does.

**Revisit when:** outside contributions are wanted (then a DCO or a
contributor agreement), a second maintainer joins, the brand needs a formal
trademark policy, or the holder wants a different licence.
