---
id: ADR-073
title: Every GitHub Action runs at a commit SHA
date: 2026-10-14
status: accepted
area: Infrastructure and deploys
supersedes: []
extends: [ADR-069]
---

# ADR-073 — Every GitHub Action runs at a commit SHA

**Context:** The workflows named their actions by tag (`actions/checkout@v7`).
A tag is a pointer the action's owner, or anyone who takes over their
account, can move to other code at any time. Our next run would execute it.
That is how Trivy's own actions were turned against their users in March
2026 (ADR-069). Here, the deploy job holds the GHCR and Dokploy secrets, the
docs publisher holds Cloudflare's, and the release job can push images. A
commit SHA can't be moved: the same 40 characters always name the same code.

**Decision:** Every `uses:` in `.github/workflows/` names a full commit SHA,
with the exact `vX.Y.Z` version as a trailing comment:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

- **The first pins kept behaviour unchanged.** Each SHA is the commit the
  old tag pointed to on 2026-10-14. That was the newest release in each
  major, except `pnpm/action-setup@v6`, which still pointed at v6.0.10, not
  v6.1.0. Dependabot will offer v6.1.0 like any other update.
- **Dependabot keeps them current** (`.github/dependabot.yml`, already
  watching `github-actions`). It reads the `# vX.Y.Z` comment and moves the
  SHA and the comment together, in the same weekly group as before.
- **A unit test enforces it** ([actions-pinned.test.ts](../../tests/unit/actions-pinned.test.ts)):
  it refuses a tag, a branch, a short or uppercase SHA, and a SHA without
  its version comment. It allows only local `./` actions and `docker://`
  images pinned by `sha256` digest. It checks both the lines (for the
  version comment, which the YAML parser drops) and the values the parser
  finds, so quoting a key or writing `{ uses: … }` can't hide an action.
- **The security reviewer** (`.claude/agents/security-reviewer.md`) treats
  an unpinned `uses:` as a BLOCKER.

**Rejected:** major tags (the threat above); exact version tags such as
`@v7.0.1` (still a pointer that can be moved); copying the actions into this
repository (we would have to keep their code up to date ourselves, and
Dependabot couldn't help); GitHub's "require actions pinned to a full SHA"
setting alone (we can't see it in the repository, and it doesn't cover the
version comment Dependabot needs). The setting can still be turned on as an
extra layer.

**Consequences:** A SHA guards against a moved tag, not against a
malicious release. Dependabot will still propose the next version, so its
PRs need the same reading as any dependency's. Diffs show long hashes; the
comment carries the version people read. An action's own steps can still
fetch code at run time (an action that downloads a tool, for example).
Those are pinned in the step that downloads them, as `TRIVY_IMAGE` already
is.

**Revisit when:** GitHub ships immutable releases for actions that we can
require, or an action we use stops publishing release tags Dependabot can
follow.
