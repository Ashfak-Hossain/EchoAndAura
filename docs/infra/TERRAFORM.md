# Terraform

Status: ACTIVE · Owner: Evan · Last updated: 2026-10-05

Terraform keeps the Cloudflare and AWS set-up as code in
`ops/terraform/` (ADR-062). Before Terraform, every setting was a click in
a dashboard. Now the files say how things should be, and Terraform makes
the real thing match them. This page is how to use it day to day. It is
written for someone who has never used Terraform.

What it manages, and what it deliberately does not, is in ADR-062. In
short: DNS, zone rules and settings, Access, SES, IAM, budgets. Not R2 or
Email Routing (the token would need rights over the backups; ADR-062
addendum). **Never** anything
whose creation produces a secret (access keys, API tokens, the Turnstile
widget). Those stay hand-made and listed in [SECRETS.md](SECRETS.md).

**D3A prepared, not applied:** Pages hosting is declared in `pages.tf`, with
staged hostname attachment in `dns.tf` and a narrow docs-host rate-limit
exception. These are not yet confirmed live resources. See
[Publishing the developer docs](DOCS_PUBLICATION.md) for a line-by-line Terraform
walkthrough, the two expected plans, required Pages token permission and
separate protected CI upload credentials. The permission is a required owner
setup step, not a claim that the existing token has already been changed.

---

## Words you need

| Word           | Meaning                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Provider**   | A plug-in that talks to one service. `aws` talks to AWS, `cloudflare` to Cloudflare.                                                                            |
| **Resource**   | One thing Terraform looks after: a DNS record, a bucket, an IAM user.                                                                                           |
| **State**      | Terraform's notebook: which real things belong to which resource in the code. Kept in S3 ([AWS.md](AWS.md#terraform-state)), never in this repo or on a laptop. |
| **Plan**       | A preview. Reads the real world, compares it with the code, lists what it would change. Changes nothing. Always safe.                                           |
| **Apply**      | Makes the changes. Shows the plan again and waits for you to type `yes`.                                                                                        |
| **Import**     | "This thing already exists; it is yours now." How the hand-made set-up came under Terraform without being rebuilt.                                              |
| **No changes** | The plan's best answer: code and reality match.                                                                                                                 |
| **Drift**      | Someone changed a setting in a dashboard, so reality no longer matches the code. The next plan shows it.                                                        |

## Layout

```
ops/aws/terraform-state.yaml     the S3 bucket for the state (CloudFormation, made once)
ops/terraform/aws/               AWS: SES, SNS, IAM, budgets, the off-site bucket
ops/terraform/cloudflare/        Cloudflare: DNS, zone rules and settings, Access
ops/terraform/.tflint.hcl        lint rules for both folders
```

Two folders, two state files. A Cloudflare apply can never change AWS.

Each folder has `versions.tf` (exact versions and where the state lives),
`providers.tf` (how to sign in), and one file per area once resources
arrive. `.terraform.lock.hcl` is committed: it pins the providers'
checksums (macOS and Linux; after a provider upgrade run
`terraform providers lock -platform=darwin_arm64 -platform=linux_amd64`
in the folder). `.terraform/` is a local download cache and is git-ignored.

**CI** (`.github/workflows/ci.yml`, job `terraform`) checks every pull
request, for both folders: `terraform fmt -check`, `init -backend=false`
from the lock file, `validate`, and `tflint`. It has no credentials and
never touches the state, so it can't plan or change anything. A red
`terraform` check usually means: run `terraform fmt -recursive
ops/terraform` and commit. Plan and apply stay on a laptop.

## Before you start (once per laptop)

1. Terraform **1.15.6** exactly (`terraform version`). Another version is
   refused by `required_version`; upgrading is its own PR.
2. AWS sign-in: profile `echoandaura` in `~/.aws/config` (see
   [AWS.md](AWS.md#account)). Both folders need it, because the state is in S3.
3. Cloudflare: in `.env`, `CLOUDFLARE_API_TOKEN`,
   `TF_VAR_cloudflare_account_id`, `TF_VAR_cloudflare_zone_id`. The token
   is Bitwarden `Cloudflare Terraform token` ([SECRETS.md](SECRETS.md)).
   And the Access email lists, as JSON, in this order (Bitwarden
   `Cloudflare Access`):
   ```
   TF_VAR_access_admin_emails='["<developer>","<Raj>"]'
   TF_VAR_access_developer_emails='["<developer>"]'
   ```
4. AWS: in `.env`, `TF_VAR_ses_feedback_email` (the developer's Gmail,
   which receives SES bounces and complaints), and the budget alert
   addresses `TF_VAR_alerts_developer_email`, `TF_VAR_alerts_account_email`.
   These two are not marked sensitive (marking them would rewrite every
   live alert once), so a plan can print them: never paste such a plan in
   public.
5. `pnpm tf:aws init` and `pnpm tf:cloudflare init`: downloads the
   providers and connects to the state. Run again after a version change.

## The Cloudflare token

An **account** API token named `terraform` (Manage Account → Account API
Tokens), not a personal one: it keeps working when a person's membership
changes. Bitwarden `Cloudflare Terraform token`; only in the laptop's
`.env`. It gets the permissions the code needs and no more. Add a row
here when a new area comes under Terraform. Editing a token's
permissions keeps its value, so `.env` does not change.

| Scope                              | Permission                                  | Needed for                             |
| ---------------------------------- | ------------------------------------------- | -------------------------------------- |
| Specified domain `echoandaura.com` | Zone → Read                                 | everything in the zone                 |
| Specified domain `echoandaura.com` | DNS → Edit                                  | `dns.tf`                               |
| Specified domain `echoandaura.com` | Zone WAF → Edit                             | `rules.tf`: `waf_custom`, `rate_limit` |
| Specified domain `echoandaura.com` | Cache Rules → Edit                          | `rules.tf`: `cache`                    |
| Specified domain `echoandaura.com` | Single Redirect → Edit                      | `rules.tf`: `redirect`                 |
| Specified domain `echoandaura.com` | Zone Settings → Edit                        | `zone.tf`: email obfuscation, DNSSEC   |
| Entire account                     | Access (Cloudflare One / Zero Trust) → Edit | `access.tf`: apps and policies         |

## What is managed

| Folder        | File                 | Resources                                                                                                                                  | Since      |
| ------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `cloudflare/` | `dns.tf`             | the 11 DNS records we own ([CLOUDFLARE.md → DNS](CLOUDFLARE.md#dns--the-authoritative-record-list))                                        | 2026-10-05 |
| `cloudflare/` | `rules.tf`           | the 4 zone rule lists: WAF custom (3 rules), rate limit, cache, www→root redirect. Terraform owns each **whole** list                      | 2026-10-05 |
| `cloudflare/` | `zone.tf`            | email obfuscation (off), DNSSEC (on)                                                                                                       | 2026-10-05 |
| `cloudflare/` | `access.tf`          | Access apps `Admin`, `Dokploy`; policies `admins`, `developer`, `github deploy`. Emails from `.env` (sensitive)                            | 2026-10-05 |
| `aws/`        | `ses.tf`             | SES domain identity, MAIL FROM, feedback forwarding, Bounce/Complaint topics; SNS `ses-feedback`, its policy, the email subscription       | 2026-10-05 |
| `aws/`        | `iam.tf`             | user `echoandaura-worker` and its `ses-send-only` policy (never its key)                                                                   | 2026-10-05 |
| `aws/`        | `budgets.tf`         | 3 budgets, the hard-stop action and `BudgetsActionsRole`, the cost-anomaly monitor and subscription                                        | 2026-10-05 |
| `aws/`        | `offsite_backups.tf` | the off-site backup bucket (versioning, lifecycle, encryption, policy) and its upload-only user (never its key). Moved from CloudFormation | 2026-10-06 |

Adopting something that already exists: write the resource in code, add
an `import { to = …, id = "…" }` block, run `plan`. It must say
`N to import, 0 to add, 0 to change, 0 to destroy`. Apply, then delete the
import block and plan again: **No changes**.

## Making a change

```bash
aws login --profile echoandaura     # only when the session has expired
pnpm tf:aws plan                    # or: pnpm tf:cloudflare plan
```

1. Edit the `.tf` file on a branch.
2. `pnpm tf:<aws|cloudflare> plan`. Read every line. `+` creates, `~`
   changes in place, `-` destroys, `-/+` **destroys and recreates**. A
   `-` or `-/+` you did not expect means stop.
3. Open the PR; paste the plan's summary line in it.
4. After review, `pnpm tf:<aws|cloudflare> apply`, read it again, type `yes`.
5. Run plan once more: it must say **No changes**.
6. Update the matching doc page (CLOUDFLARE.md / AWS.md) and its History.

**Never change a managed setting in the dashboard.** The next apply
would quietly undo it. In an emergency, change it in the dashboard, then
copy the same change into the code the same day. Plan shows **No
changes** once they match.

## Provider updates (Dependabot)

Every Sunday Dependabot checks the `aws` and `cloudflare` providers. Minor
and patch updates arrive together as one PR labelled `infra`; a major
version (e.g. cloudflare 5 → 6) comes alone, and needs its upgrade guide
read first: majors rename and remove things.

A provider is the translator between our code and the service, so a new
one can read the same settings differently. CI can't catch that: it never
talks to Cloudflare or AWS. So, for each such PR:

1. CI green (`terraform (aws)`, `terraform (cloudflare)`). A red
   `init` usually means the lock file lacks the Linux checksums: check
   out the branch, run
   `terraform providers lock -platform=darwin_arm64 -platform=linux_amd64`
   in that folder, commit, push.
2. Merge, then on `main`: `pnpm tf:<aws|cloudflare> init -upgrade`, then
   `plan`. It should say **No changes**. If it wants changes nobody made,
   the provider reads something differently: read the provider's
   changelog for that resource and fix the code (or pin the old version
   back) before anyone applies.
3. A History row here: `aws 6.67.0 → 6.x.y, plan = No changes`.

Terraform itself (`required_version` in both `versions.tf`, and
`terraform_version` in `.github/workflows/ci.yml`) is not updated by
Dependabot: upgrade all three together, by hand, in their own PR.

## When something goes wrong

- **`Error acquiring the state lock`**: another plan/apply is running, or
  one was killed. If you are sure nothing is running:
  `pnpm tf:aws force-unlock <LOCK_ID>` (the id is in the error).
- **`ExpiredToken` / `session has expired`**: `aws login --profile echoandaura`.
- **Plan wants to change something nobody touched**: drift. Find out who
  changed it and why (Cloudflare audit log, AWS CloudTrail), then either
  apply (the code wins) or update the code (reality wins).
- **A bad apply**: fix forward in code and apply again. If the state
  itself is damaged, restore the previous version of the state file in S3
  ([AWS.md](AWS.md#terraform-state)).

## History

| Date       | Change                                                                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-05 | ADR-062. State bucket created. `ops/terraform/{aws,cloudflare}` set up with pinned versions; no resources yet                                                                                      |
| 2026-10-05 | Cloudflare token `terraform` (Zone Read, DNS Edit). 11 DNS records imported with no change; plan = No changes                                                                                      |
| 2026-10-05 | Token: + Zone WAF, Cache Rules, Single Redirect, Zone Settings (Edit). 4 rulesets and 2 zone settings imported with no change; plan = No changes. 17 resources managed                             |
| 2026-10-05 | R2 and Email Routing kept out (ADR-062 addendum). Token: + Access Edit (account). Access apps and policies imported; emails as sensitive `.env` variables. Plan = No changes. 22 resources managed |
| 2026-10-05 | AWS: SES, SNS feedback, the worker user imported (10); plan = No changes. `pnpm tf:aws` now loads `.env`                                                                                           |
| 2026-10-05 | AWS budgets, hard-stop action and role, anomaly detection imported (8); plan = No changes                                                                                                          |
| 2026-10-06 | First real change through Terraform: budget limits raised (3 changed). 40 resources managed: 22 Cloudflare, 18 AWS                                                                                 |
| 2026-10-06 | Off-site backups moved from CloudFormation (Retain, delete stack, import 9, 0 changed). Migration complete: 49 resources, 22 Cloudflare + 27 AWS                                                   |
| 2026-10-06 | Dependabot watches the `aws` and `cloudflare` providers weekly (Phase 9.1); see Provider updates                                                                                                   |
