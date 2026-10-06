---
id: ADR-062
title: 'Terraform for Cloudflare and AWS: imported, never recreated; no secrets in state'
date: 2026-10-05
status: accepted
area: Infrastructure and deploys
supersedes: [ADR-051]
extends: []
---

# ADR-062 — Terraform for Cloudflare and AWS: imported, never recreated; no secrets in state

**Date:** 2026-10-05 · **Status:** Accepted

**Context:** The Cloudflare and AWS set-up was made by hand in the
consoles. CLOUDFLARE.md and AWS.md record it, and `pnpm infra:check`
checks the docs against what is live. That is three copies of one truth,
kept in step by care. A rebuild is a long runbook, and a change can't be
reviewed before it happens. Only the off-site bucket was code
(CloudFormation, ADR-051). The project is being handed to Raj.

**Decision:**

- **Terraform owns** Cloudflare DNS, the WAF and cache rules, zone
  settings, R2 buckets and their CORS, Access apps and policies, Email
  Routing; and in AWS: SES identities and their notification settings,
  the SNS feedback topic, IAM users and roles with their policies, the
  budgets and the hard-stop action, and the off-site backup bucket
  (moved from CloudFormation).
- **Two root modules**, `ops/terraform/cloudflare` and
  `ops/terraform/aws`: separate state, separate credentials, so a
  Cloudflare change can never touch AWS.
- **State in S3**, `echoandaura-terraform-state` in `ap-south-1`
  (versioned, encrypted, private, HTTPS only), locked with S3's own lock
  file (`use_lockfile`, no DynamoDB). The bucket is the one thing
  Terraform can't make for itself, so a small CloudFormation stack does
  (`ops/aws/terraform-state.yaml`). Cost: fractions of a cent. Not in R2:
  losing the Cloudflare account would lose the state that rebuilds it.
- **No secrets in state.** Anything whose creation returns a secret stays
  hand-made, as ADR-051 already did for the backup key: IAM access keys,
  R2 API tokens, the Turnstile widget, the Access service token, the
  Cloudflare API token Terraform itself uses.
- **Imported, never recreated.** Every resource comes in through an
  `import` block. A slice is done only when `terraform plan` says **No
  changes** against what is live. Resources whose loss is an outage
  (records that carry mail, buckets, the SES identity) get
  `prevent_destroy`.
- **Pinned exactly:** Terraform 1.15.6, providers `aws` 6.67.0 and
  `cloudflare` 5.26.0, `.terraform.lock.hcl` committed.
- **Applied from the laptop by a person.** CI runs `fmt -check`,
  `validate` and `tflint` without credentials; it never plans or applies.

**Out of scope:** the VPS (no BengalCloud provider), Dokploy (its compose
file is already in the repo), the gate relay Worker (`wrangler` deploys
it, ADR-058), root and `ash-admin`.

**Scope addendum (2026-10-05): R2 and Email Routing stay hand-managed.**
Managing R2 needs _Workers R2 Storage → Edit_ on the whole account; it
can't be narrowed to one bucket. The Terraform token could then read or
delete the database backups (every buyer's details), for two buckets and
one CORS rule that were set once. Email Routing is one rule that never
changes, and its permission would let a leaked token forward `hello@`
anywhere. Both stay as CLOUDFLARE.md records them, watched by
`pnpm infra:check`. This narrows the first bullet above: in Cloudflare,
Terraform owns DNS, the zone rules, zone settings and Access.

**Consequences:**

- A change is a diff in a pull request, then `plan`, then `apply`. Drift
  shows up as a non-empty plan.
- `pnpm infra:check` stays for what Terraform can't see: DNS as resolvers
  answer it, and SES behaviour. The checks that duplicate Terraform's go.
- One more tool, and one more token (Cloudflare, scoped to this account
  and zone; Bitwarden, SECRETS.md).
- A console change made in a hurry must be copied back into the code, or
  the next apply undoes it.

**Rejected:** OpenTofu (its client-side state encryption only matters if
secrets were in state, and they aren't); HCP Terraform (another account
to secure for one person's state); keeping CloudFormation for the
off-site bucket (two IaC tools for one small AWS account); Pulumi / CDK
(a program where a declaration is enough).

**Migration done (2026-10-06).** Terraform manages 49 resources: 22 in
Cloudflare, 27 in AWS, each imported with no change at the provider (the
only diffs were Terraform marking values sensitive). The off-site bucket
left CloudFormation by Retain-then-delete. The first real change made
through Terraform was the budget limits ($0.25 alert, $5 monthly, $10
hard stop). CloudFormation remains for one stack only, the state bucket.
