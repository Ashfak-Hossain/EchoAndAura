# Terraform

Status: IN PROGRESS · Owner: Evan · Last updated: 2026-10-05

Terraform keeps the Cloudflare and AWS set-up as code in
`ops/terraform/` (ADR-062). Before Terraform, every setting was a click in
a dashboard. Now the files say how things should be, and Terraform makes
the real thing match them. This page is how to use it day to day. It is
written for someone who has never used Terraform.

What it manages, and what it deliberately does not, is in ADR-062. In
short: DNS, rules, buckets, Access, SES, IAM, budgets. **Never** anything
whose creation produces a secret (access keys, API tokens, the Turnstile
widget). Those stay hand-made and listed in [SECRETS.md](SECRETS.md).

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
ops/terraform/cloudflare/        Cloudflare: DNS, rules, R2, Access, Email Routing
```

Two folders, two state files. A Cloudflare apply can never change AWS.

Each folder has `versions.tf` (exact versions and where the state lives),
`providers.tf` (how to sign in), and one file per area once resources
arrive. `.terraform.lock.hcl` is committed: it pins the providers'
checksums. `.terraform/` is a local download cache and is git-ignored.

## Before you start (once per laptop)

1. Terraform **1.15.6** exactly (`terraform version`). Another version is
   refused by `required_version`; upgrading is its own PR.
2. AWS sign-in: profile `echoandaura` in `~/.aws/config` (see
   [AWS.md](AWS.md#account)). Both folders need it, because the state is in S3.
3. Cloudflare: in `.env`, `CLOUDFLARE_API_TOKEN`,
   `TF_VAR_cloudflare_account_id`, `TF_VAR_cloudflare_zone_id`. The token
   is Bitwarden `Cloudflare Terraform token` ([SECRETS.md](SECRETS.md)).
4. `pnpm tf:aws init` and `pnpm tf:cloudflare init`: downloads the
   providers and connects to the state. Run again after a version change.

## The Cloudflare token

An **account** API token named `terraform` (Manage Account → Account API
Tokens), not a personal one: it keeps working when a person's membership
changes. Bitwarden `Cloudflare Terraform token`; only in the laptop's
`.env`. It gets the permissions the code needs and no more. Add a row
here when a new area comes under Terraform. Editing a token's
permissions keeps its value, so `.env` does not change.

| Scope                              | Permission  | Needed for             |
| ---------------------------------- | ----------- | ---------------------- |
| Specified domain `echoandaura.com` | Zone → Read | everything in the zone |
| Specified domain `echoandaura.com` | DNS → Edit  | `dns.tf`               |

## What is managed

| Folder        | File     | Resources                                                                                           | Since      |
| ------------- | -------- | --------------------------------------------------------------------------------------------------- | ---------- |
| `cloudflare/` | `dns.tf` | the 11 DNS records we own ([CLOUDFLARE.md → DNS](CLOUDFLARE.md#dns--the-authoritative-record-list)) | 2026-10-05 |

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

| Date       | Change                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| 2026-10-05 | ADR-062. State bucket created. `ops/terraform/{aws,cloudflare}` set up with pinned versions; no resources yet |
| 2026-10-05 | Cloudflare token `terraform` (Zone Read, DNS Edit). 11 DNS records imported with no change; plan = No changes |
