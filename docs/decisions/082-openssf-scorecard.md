---
id: ADR-082
title: 'OpenSSF Scorecard, published, without an admin token'
date: 2026-10-25
status: accepted
area: Infrastructure and deploys
supersedes: []
extends: []
---

# ADR-082 — OpenSSF Scorecard, published, without an admin token

**Context:** The repository is meant to be an example of how a production
app is run. Most of its supply-chain practice (actions pinned by SHA,
least-privilege tokens, signed images, Dependabot, tag rulesets) is only
visible to someone who reads the workflows. The OpenSSF Scorecard checks
the same things from outside and publishes a score anyone can verify.

**Decision:** A [Scorecard workflow](../../.github/workflows/scorecard.yml)
runs on every push to `main` and weekly. After a ruleset change, run it
by hand: `branch_protection_rule` fires only for classic branch
protection, and this repository uses rulesets.

- **Published.** `publish_results: true` signs the result with the job's
  OIDC token and sends it to the Scorecard API, which serves the README
  badge. The findings are uploaded to Code scanning too.
- **Least privilege.** The workflow's token has no permissions; the one job
  gets `contents: read`, `actions: read`, `security-events: write` and
  `id-token: write`. The checkout keeps no credentials.
- **No admin token.** Branch-Protection can read every rule only with an
  admin personal access token. The default token reads less, so that check
  scores lower. `pnpm rulesets:check` already verifies the rules.
- [scorecard-workflow.test.ts](../../tests/unit/scorecard-workflow.test.ts)
  keeps the permissions and the steps as they are: Scorecard's API refuses
  a result from a job with extra steps or env, and the badge would stop
  updating without an error anyone sees.

**Rejected:**

- An admin token as `repo_token`: a long-lived secret that can change
  repository settings, held by a workflow, for a few points.
- Running Scorecard without publishing: no badge, and nobody outside can
  check the score.

**Consequences:** The score is capped. Code-Review stays low because there
is one maintainer and no second reviewer; Branch-Protection is partial
without the admin token. Those findings appear in Code scanning, and are
dismissed there with the reason, never by weakening a rule. A new step in
the job must be one Scorecard's API accepts. The score and each check's
result are public on scorecard.dev; the Code-scanning alerts are visible to
maintainers only.

One supply-chain risk is accepted, not fixed: the action is pinned by SHA,
but it runs a container image named by tag
(`ghcr.io/ossf/scorecard-action:v2.5.0`). A swapped image would get this
job's token: it could dismiss or forge Code-scanning alerts and publish a
false score. It could not sign a deploy (Release checks the signer is
`deploy.yml` on `main`) or reach any app secret. Closing it would mean
forking the action.

**Revisit when:** a second maintainer reviews pull requests; Scorecard can
read rulesets with the default token; or the publishing API's rules change.
