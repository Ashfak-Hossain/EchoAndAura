---
id: ADR-089
title: 'Weekly drift check: a read-only plan in GitHub Actions, results without details'
date: 2026-10-28
status: accepted
area: Infrastructure and deploys
supersedes: []
extends: [ADR-062, ADR-082]
---

# ADR-089 — Weekly drift check: a read-only plan in GitHub Actions, results without details

**Context:** Cloudflare and AWS are code (ADR-062), but the code is only
true while nobody changes a managed setting in a dashboard. A change there
shows up only the next time someone runs `plan` on a laptop, which can be
weeks later, and the next `apply` then undoes it without a word. Until now
CI never talked to either service. The repository is public, so its Actions
logs and issues are public too, and a plan prints resource ids, the AWS
account id and email addresses.

**Decision:**

- **A weekly plan in GitHub Actions** ([drift.yml](../../.github/workflows/drift.yml)),
  Mondays 03:00 Dhaka and by hand. It plans both modules with
  `-detailed-exitcode` and reduces each to one word: `clean`, `drift` or
  `failed` ([drift-plan.sh](../../ops/terraform/drift-plan.sh)).
- **No details leave the runner.** All Terraform output, errors included,
  goes to a temp file that nothing reads and that is deleted on exit. The
  log shows only the words. If either module isn't clean, the `report` job
  opens one issue, "Drift check needs attention", or comments on the open
  one. It closes the issue when both come back clean. The person reads the
  details with `pnpm tf:<module> plan` on a laptop, as before.
- **Two jobs, split by what they hold.** `plan` has the credentials and
  only `contents: read` and `id-token: write`. `report` can write issues
  but holds no secrets and checks out no code.
- **AWS without a stored key.** A GitHub OIDC provider and the role
  `echoandaura-drift-check` ([drift_check.tf](../../ops/terraform/aws/drift_check.tf)).
  The role trusts only `repo:Ashfak-Hossain/echoandaura:environment:drift`,
  and the GitHub environment `drift` allows only `main`. Credentials last
  15 minutes. They are written to the `echoandaura` profile that both
  backends and the AWS provider already name, so the `.tf` files are the
  same in CI and on a laptop.
- **ReadOnlyAccess, minus data.** AWS's managed `ReadOnlyAccess` keeps the
  check working when a new kind of resource is added. An inline Deny takes
  back what it would also read: every S3 object except the state files (the
  off-site backups hold buyers' details), secret and parameter values, KMS
  decrypt, logs, DynamoDB items, SQS messages, Athena results, and SES's
  suppression list and contacts (buyers' addresses). Listing a bucket
  still shows the backups' names, sizes and times: metadata, accepted.
- **No lock.** `-lock=false`: the lock is an object written to the state
  bucket, and the role can't write. A plan changes nothing.
- **Cloudflare with its own read-only token**, made by hand like every
  token (ADR-062), Read on exactly the permission groups the `terraform`
  token has Edit on (TERRAFORM.md → Drift check).
- **Tests:** [drift-check.test.ts](../../tests/unit/drift-check.test.ts)
  runs the script against a fake `terraform` that prints private values and
  checks none reach stdout or stderr, the exit-code mapping, the plan flags,
  each job's permissions, and the role's trust and Deny.

**Rejected:**

- Printing the plan, or a summary of its resource addresses: addresses name
  resources whose ids or emails a reader could then look up, and a failed
  plan's error prints the account id. One word per module is enough to
  know that someone must look.
- Telegram instead of an issue: private, but one more secret in GitHub,
  and an issue records when drift was found and fixed.
- A hand-written list of read actions: tighter, but every new kind of
  resource would make the check fail until the list caught up.
- An access key for a read-only user: a long-lived secret to rotate, which
  OIDC avoids.
- The `terraform` Cloudflare token: it can edit DNS, WAF and Access.

**Consequences:** Nine more secrets live in GitHub (the role ARN, the
Cloudflare read token, the account and zone ids, the email addresses), in the
`drift` environment only. Read-only credentials still read configuration
across the account, including the Access email lists and IAM; whoever can
change a workflow on `main` can use them, which today is the owner. A
`failed` week is ambiguous by design: an expired token and an outage look
the same, and the details need a laptop. The Cloudflare read token must
gain Read on each new permission group the `terraform` token gains Edit on.

**Revisit when:** the repository or its owner is renamed or transferred
(the trust names the repository, so whoever takes the old name would
match it: switch the OIDC subject to the numeric ids), a second
maintainer can merge to `main`, the repository
becomes private (then the plan could be printed), Cloudflare tokens can be
issued by OIDC, or a resource needs a permission that ReadOnlyAccess lacks.
