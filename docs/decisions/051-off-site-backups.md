---
id: ADR-051
title: Off-site backup copy in AWS S3, and hourly backups during an event's sales window
date: 2026-10-03
status: partly-superseded
area: Infrastructure and deploys
supersedes: []
extends: []
---

# ADR-051 — Off-site backup copy in AWS S3, and hourly backups during an event's sales window

**Date:** 2026-10-03 · **Status:** Accepted, partly superseded by [ADR-062](062-terraform.md) (the AWS side is now Terraform, not CloudFormation)

**Context:** Every Postgres backup (ADR-036) went to R2 in the same
Cloudflare account that serves the site, and Dokploy's R2 key may delete
(it enforces "keep the latest 14"). Losing that account, or someone on the
server deleting with that key, would take every copy at once. A nightly
backup also means up to 24 hours of orders lost on a restore, and during a
sale those hours are the busiest.

**Decision:**

- **A second Dokploy backup of the same database to AWS S3**,
  `echoandaura-offsite-backups` in `ap-south-1`, daily at 03:30 Dhaka
  (30 minutes after the R2 one). The AWS account already exists and is
  secured (MFA, budgets); the bucket costs cents a month (about 15 kB per
  dump today).
- **Its key can't delete.** IAM user `echoandaura-offsite-backups-dokploy`:
  list, upload, read; delete, delete-version and every bucket-config change
  explicitly denied. Versioning keeps the original if the key overwrites a
  file. **Expiry is S3 lifecycle (35 days, including old versions), not
  Dokploy's keep-latest**, which needs delete rights. Read (`GetObject`) is
  allowed because rclone checks each upload with a HEAD and Dokploy can't
  pass `--s3-no-head`: without it, the file landed but the backup reported
  failure (seen 2026-10-03).
- **Infrastructure as code:** `ops/aws/offsite-backups.yaml`
  (CloudFormation, stack `echoandaura-offsite-backups`). _Superseded
  2026-10-06 by ADR-062: now `ops/terraform/aws/offsite_backups.tf`._ The access key is
  made by hand in the console, so the secret never passes through
  CloudFormation.
- **An hourly R2 schedule for the sales window**, `postgres-hourly/`,
  latest 48 kept, created **disabled**. Switched on when registration
  opens (20 days before) and off the day after the event (RUNBOOK → Event
  night). Plus a manual backup before doors open and after the event.

**Consequences:**

- Three independent copies: R2 nightly (14 days), S3 daily (35 days),
  and during a sale R2 hourly (2 days). A worst-case restore during a sale
  loses about an hour, reconciled against the bKash statement.
- Restoring when Cloudflare is gone: download from S3 as `ash-admin`
  (RUNBOOK → Restore from backup). Tested 2026-10-03: the dump lists all
  16 tables with data.
- The S3 key, if stolen, reads buyer data in the backups. It lives only in
  Dokploy and Bitwarden; the server already holds the live database.
- The hourly schedule is a manual switch, so it relies on the event
  checklist.

**Rejected:** Backblaze B2 / Google Drive (another account to secure, or a
key that can delete); weekly manual download to a laptop (relies on memory,
buyer data on a laptop); S3 Object Lock (rclone's streamed uploads and
lock headers untested, and the delete-deny already covers the server
threat); continuous WAL archiving / point-in-time recovery (too many moving
parts on a 4 GB server for hundreds of orders per event).

**Revisit when:** an event sells thousands of orders (consider WAL
archiving), or the dump grows past ~100 MB.
