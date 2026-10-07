---
id: ADR-065
title: Publish tested static docs through a separate Pages uploader
date: 2026-10-07
status: accepted
area: Infrastructure and deploys
supersedes: []
extends: [ADR-062, ADR-064]
---

# ADR-065 — Publish tested static docs through a separate Pages uploader

**Context:** The static learning site is ready for hosting. The repository's
CI already checks its export and browser behavior. Publishing must not expose
application credentials to docs builds or privileged credentials to PR code.

**Decision:** Terraform declares a Direct Upload Pages project, a staged custom
domain association and an explicitly owned CNAME. The owner reviews and applies
each production change. CI packages only tested static output; a separate,
disabled-until-configured workflow uploads the exact successful run's artifact.
Trusted default-branch code verifies provenance, static-only files and current
revisions. Only a green push at current main selects production; current,
same-repository PRs select our own `pr-N` preview branches. GitHub environments
hold separate Pages-only tokens; only the upload step receives them. No app
deployment logic changes in this slice. See
[the implementation](../../.github/workflows/docs-deploy.yml) and
[the owner-operated walkthrough](../infra/DOCS_PUBLICATION.md).

**Rejected:** A second Cloudflare Git build would duplicate CI and risk different
output. Running PR code in a credentialed publisher, or choosing its branch
from artifact metadata, crosses the trust boundary. Latest-commit app-deploy
filtering can miss earlier un-deployed changes, so D3B needs a reliable confirmed
deployment baseline separately.

**Consequences:** Direct Upload cannot switch to native Git integration on the
same project. Pages token permissions are account-wide, not project-wide;
environment protection remains important. Preview content is public, with
noindex as indexing guidance only. Static validation and marker scans are not
a guarantee against every possible secret. Uploads are serialized and stale
runs rechecked, but GitHub/Pages cannot make that check/upload atomic. Existing
zone rate limiting excludes only the exact docs hostname; all other protection
is retained. DNS/TLS and live search/404 remain activation gates, not assumptions.

**Revisit when:** Docs need server-side execution, account-wide Pages token
scope becomes unacceptable, or D3B can identify the app's confirmed deployed
revision safely.
