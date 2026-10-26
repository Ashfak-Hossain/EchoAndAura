---
id: ADR-088
title: 'Restore drill: the newest off-site backup, restored on the server in a throwaway, compared with live'
date: 2026-10-27
status: accepted
area: Infrastructure and deploys
supersedes: []
extends: [ADR-051]
---

# ADR-088 — Restore drill: the newest off-site backup, restored on the server in a throwaway, compared with live

**Context:** Three schedules write backups (ADR-051), but a backup is
only proven when it restores. The last full restore was on 2026-09-28,
from R2, on the developer's Mac. The S3 off-site copy, the one left if
the Cloudflare account is lost, had only been listed (`pg_restore -l`,
2026-10-03). Postgres, the images and Docker have changed since. The
server upgrade (Phase 9.5) needs a restore proven just before it. Every
backup holds every buyer's name, email and phone.

**Decision:**

- **One command, run by the owner:** `pnpm backup:drill`
  ([scripts/restore-drill.ts](../../scripts/restore-drill.ts)), monthly
  and before each event (RUNBOOK → Restore drill). It finds the newest
  object in the S3 bucket as `ash-admin`; a newest object not named like
  a backup stops it. Then it copies
  [ops/db/restore-drill.sh](../../ops/db/restore-drill.sh) and the two
  files beside it to a temp folder on the server, checks their sha256
  against the repository's, and streams the download into it over ssh.
- **Committed code only.** It refuses to start while `ops/db/`, the script
  or `package.json` has uncommitted changes. Only the owner commits, so a
  session's unreviewed edit can't reach production on the owner's next
  run (the sha256 check alone would pass it). It loads no `.env`.
- **Claude does not run it (ADR-072).** Its ssh is out of
  `guard-bash.sh`'s sight, so the script itself refuses a Claude Code
  session (`CLAUDECODE` set) and a run with no terminal. That covers every
  way of starting it. As earlier stops: `.claude/settings.json` denies the
  usual commands, and the hook refuses a package manager naming
  `backup:drill`, the TypeScript file run without `--local` right after
  it, and any ssh that names the server script.
- **On the server, in a throwaway.** The script starts a container from
  the live Postgres container's own image ID (matched by its whole Swarm
  task name, exactly one), with no network, no logs (Postgres logs a
  failing row in full), no swap (checked in the container's cgroup, not
  assumed), and its data directory on a tmpfs at the image's VOLUME path,
  so Docker makes no volume on disk. It removes the container on every
  exit, signals and a dropped connection included, and any left by a drill
  whose script is gone. The dump is never written to a file, on the laptop
  or the server; the stream's buffers are ordinary host memory, which the
  host may swap.
- **Locked down against a crafted backup.** Anyone with the Dokploy key
  can write a backup, and `pg_restore` runs its SQL as a superuser, which
  can write files and start programs. So the root is read-only (only small
  tmpfs mounts are writable), at most 128 processes, all capabilities but
  the five the entrypoint needs dropped, no new privileges, and an OOM
  score that makes the kernel kill the drill before live Postgres.
- **Compared with live, read-only.** Live queries run with
  `default_transaction_read_only=on` and short statement and lock
  timeouts, so Postgres refuses any write and the app never waits on the
  drill. Nothing from the backup goes into a live query except the last
  audit time, as whole microseconds checked to be digits: anyone with the
  Dokploy key can write a backup. The checks:
  - the file is under 26 hours old, and all of it arrived;
  - `pg_restore --exit-on-error` succeeds, which re-checks every row
    against every CHECK, UNIQUE and foreign key;
  - the tables, the migration count and a hash over every column (its full
    type), constraint, index and enum definition match live;
  - `orders`, `order_events` and `tickets` up to the backup's last audit
    row count the same as live (the app never deletes from them);
  - live has no audit row between that one and 15 minutes before the
    upload, so an old file uploaded again fails;
  - `app-role.sql` gives the app its rights on the copy (RUNBOOK's
    restore step), and the app role holds none of the rights it revokes
    on the three audit tables, on the copy or on live;
  - the server script printed `done=ok` last and exited 0. A value that
    isn't the shape its query returns fails, so a query that failed on
    both sides can't pass as equal.
- **The report can't be forged.** A table name can hold a newline, which
  would print report lines of its own. The server script stops on any
  value of more than one line, and the laptop refuses a report with a
  repeated key.
- **Only names, counts, timestamps and hashes are printed.** `pg_restore`
  errors keep their error lines only, through
  [mask-errors.awk](../../ops/db/mask-errors.awk): a quoted lowercase
  name after "table", "constraint" and the like stays; from any other
  quote on, the line is cut. Control and bidi characters are dropped from
  the report and from the server's messages before they reach the
  terminal.
- **Recorded in RUNBOOK's drill log**, without counts or sizes: the log is
  public, and either, month by month, would publish sales. The script
  prints the row. A run that skipped checks (a deploy since the backup)
  is `–`, not ✓. `/prod-check` warns when the newest row is over 31 days
  old or not ✓, and `/event-ready` when it is over 7 days old.
- **Lab mode:** `pnpm backup:drill-lab` runs the same server script
  against the compose Postgres, so the drill can be tested without
  production.

**Rejected:**

- A scheduled GitHub Action: the logs of a public repository are public,
  and GitHub would need a key that reads every backup.
- Restoring on the laptop (as on 2026-09-28): buyer data on a laptop,
  which ADR-051 already refused.
- A scratch database inside the live Postgres (RUNBOOK's restore over live
  data): it shares the live instance's memory and leaves buyer data on its
  volume until someone drops it.
- Dokploy's **Restore** button: untested, and its documentation does not
  say whether it overwrites the target.
- Testing an R2 copy too: same Dokploy job, same format, and the laptop
  has no R2 credentials. S3 is the copy that matters when Cloudflare is
  gone.
- Restoring as a non-superuser, which would rule out file writes and
  programs altogether: a real restore (RUNBOOK → Restore from backup)
  runs as the database owner, who is the superuser, and the drill proves
  that path. The lockdown above bounds what a crafted backup can do.

**Consequences:** The drill needs the owner's AWS sign-in and ssh, so it
stays a habit, not an automatic job. The `/prod-check` warning is the
reminder. The first production run needs this branch committed. It holds
up to 768 MB of memory and one CPU on the server for a few seconds, which
is fine on today's small database. A crafted backup's SQL still runs as a
superuser inside the throwaway, with no network and nothing writable
outside its memory: that is the risk accepted. The row-count check assumes the
app never deletes orders, audit rows or tickets. A retention job that
deletes them has to change this check too.

**Revisit when:** the dump grows past ~100 MB (the tmpfs and memory
limits), a retention job deletes orders or tickets, the backups move off
Dokploy, or a second server or staging can run the drill without
production's data.
