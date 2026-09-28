# Runbook

Status: ACTIVE · Owner: Evan · Last updated: 2026-09-29

What to do when something breaks, and the checklist for event night.
Each section starts from what you see, gives the order to check things,
and links the page that explains the details. Server commands run after
`ssh echoandaura`. The app's containers are:

- `echoandaura-app-5nuhfn-web-1`
- `echoandaura-app-5nuhfn-worker-1`

Postgres and Redis are the Dokploy services `echoandaura-db-ljctqy` and
`echoandaura-redis-t1myan`.

---

## Where alerts come from

| Alert                                                               | Source                                                                                       | Arrives in                                  |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Site down or unhealthy**                                          | Better Stack, checking `https://echoandaura.com/api/health` every 3 min (1 min confirmation) | email                                       |
| Dokploy dashboard down                                              | Better Stack, `https://deploy.echoandaura.com/`                                              | email                                       |
| Deploy done, **build failed**, **backup failed**, Dokploy restarted | Dokploy → Settings → Notifications (`telegram-alerts`, `email-alerts`)                       | Telegram group `echoandaura alerts` + email |
| **Disk above 80 %**                                                 | `disk-alert.timer` on the server, hourly; at most one message a day, plus one on recovery    | Telegram                                    |
| SES bounce or complaint                                             | SNS topic `ses-feedback` ([infra/AWS.md](infra/AWS.md#bounce-and-complaint-notifications))   | email                                       |
| AWS spend                                                           | AWS Budgets ([infra/AWS.md](infra/AWS.md#budgets-and-cost))                                  | email                                       |

Setup and the reasons for each choice: [infra/SERVER.md § 18](infra/SERVER.md),
ADR-040.

## The site is down, or `/api/health` is not ok

Open `https://echoandaura.com/api/health`. It answers with booleans only:

```json
{ "ok": false, "database": true, "queue": true, "worker": false }
```

| What you see                   | Meaning                                                                                                                   | Do                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| No answer, or Cloudflare 52x   | the web container, Traefik or the whole server                                                                            | [Nothing answers](#nothing-answers) |
| `"database": false`            | Postgres is down or unreachable. **Nothing works**: no pages with data, no orders                                         | [Postgres down](#postgres-down)     |
| `"queue": false`               | Redis is down. Orders are still taken, but their emails can't be queued, and buyer sign-in links are refused              | [Redis down](#redis-down)           |
| `"worker": false` (queue true) | the worker has not run its every-minute job for 3 minutes. Emails wait in the queue, and holds past 24 h are not released | [Worker down](#worker-down)         |

### Nothing answers

1. Is the server up? Run `ssh echoandaura`. If that fails, open the
   Securednoc panel: power state, then the VNC console. The provider's
   status comes next.
2. `docker ps --format '{{.Names}} {{.Status}}'`. The web container should
   be `Up … (healthy)`. If it's missing or unhealthy, read
   `docker logs --since 15m echoandaura-app-5nuhfn-web-1`.
3. Restart: Dokploy → project `echoandaura` → the compose app →
   **Deploy**. It redeploys the same image.
4. Still down, and it started with a deploy? [Roll back](#roll-back-a-deploy).
5. Disk full? Run `df -h /`, then see [Disk above 80 %](#disk-above-80).

### Postgres down

1. Dokploy → the Postgres service: is it running? Its **Logs** tab often
   says why (out of memory, disk full).
2. On the server: `docker service ps echoandaura-db-ljctqy --no-trunc`
   shows restarts and their errors.
3. Start it from Dokploy. The data lives in the volume
   `echoandaura-db-ljctqy-data`, which survives a restart.
4. If the data itself is damaged, see [Restore from backup](#restore-from-backup).

### Redis down

1. Dokploy → the Redis service → Logs, then start it.
2. Nothing is lost for good. Orders are in Postgres. Buyers see their
   payment instructions on their order page anyway. For a paid order whose
   ticket email never went out, use **Re-send tickets email** on the admin
   order page ([systems/EMAIL.md](systems/EMAIL.md)).

### Worker down

1. `docker logs --since 30m echoandaura-app-5nuhfn-worker-1`. The worker
   refuses to start without the ticket fonts or with malformed SES keys,
   and says which.
2. Restart it with Dokploy → the compose app → **Deploy**.
3. After it comes back, queued emails send themselves, and the next
   minute's run releases every hold that lapsed meanwhile. Nothing to
   re-send by hand, unless the order page shows `email.failed`.

## Roll back a deploy

[DEPLOY.md → Rolling back](DEPLOY.md#rolling-back): set `IMAGE_TAG` to the
last good `sha-…` in the compose app's Environment and deploy.
Migrations do not roll back: a migration that damaged data means
[Restore from backup](#restore-from-backup).

## Restore from backup

Backups: nightly at 03:00 Dhaka, the latest 14 kept, in R2
`echoandaura-backups` under `echoandaura-db-ljctqy/postgres/`
([infra/SERVER.md § 16](infra/SERVER.md)).

**Into an empty database** (a rebuilt server): SERVER.md § 16,
"Restore into an empty database". Tested on 2026-09-28.

**Over live data** (a bad migration, a wrong bulk change). **Not
rehearsed yet. Rehearse it on a scratch database before the first
event.** It loses everything written since that backup, so first decide
whether fixing forward is cheaper.

1. **Stop writes.** Dokploy → the compose app → **Stop**. Web and worker
   go down, and Better Stack will alert: expected.
2. **Keep what is there now.** It holds the orders placed since the backup:
   ```sh
   C=$(docker ps -q -f name=echoandaura-db-ljctqy | head -1)
   docker exec $C pg_dump -U echoandaura -d echoandaura -Fc > ~/pre-restore-$(date +%F-%H%M).dump
   ```
3. Download the chosen backup from the R2 dashboard. `scp` it to the
   server, then restore it into a **new** database:
   ```sh
   docker exec $C psql -U echoandaura -d postgres -c 'CREATE DATABASE echoandaura_restore'
   gunzip -c ~/<backup>.sql.gz | docker exec -i $C pg_restore -U echoandaura -d echoandaura_restore --no-owner --exit-on-error
   docker exec $C psql -U echoandaura -d echoandaura_restore -c 'select count(*) from orders'
   ```
4. **Swap the names.** The app's role is a superuser (Dokploy's default),
   so it can rename databases:
   ```sh
   docker exec $C psql -U echoandaura -d postgres \
     -c "ALTER DATABASE echoandaura RENAME TO echoandaura_broken_$(date +%Y%m%d)" \
     -c 'ALTER DATABASE echoandaura_restore RENAME TO echoandaura'
   ```
5. Dokploy → the compose app → **Deploy**. Check `/api/health`, the
   admin, one order.
6. **Reconcile** the orders placed between the backup and the incident.
   They are in `echoandaura_broken_…` and in the pre-restore dump. Check
   them against the bKash statement. Buyers have their order emails.
7. Drop `echoandaura_broken_…` and delete the dumps after a week, once
   nobody needs them. They hold buyer data.

## A secret leaked

[infra/SECRETS.md](infra/SECRETS.md): each row says what the secret
reaches and how to rotate it. Deactivate first, then replace, then delete,
and note it in that file's history.

## Email is not arriving

- **One buyer:** [systems/EMAIL.md → "No email arrived"](systems/EMAIL.md).
  A bounce for that address will be in the developer's Gmail
  (`ses-feedback`).
- **Nobody:** check the worker first ([Worker down](#worker-down)), then
  SES:
  - Is the account paused or under review? AWS console → SES → Account
    dashboard.
  - Were the keys denied because the budget hard stop fired?
    [infra/AWS.md → A budget alert fired](infra/AWS.md#a-budget-alert-fired).
  - Is it still in the sandbox? Then only verified addresses receive
    anything.
- **If SES is out for days:** the fallback is Postmark or Resend behind
  the `Mailer` port ([infra/AWS.md](infra/AWS.md#production-access-denied-or-stalled)).
  Meanwhile, buyers can read everything on their order page and ticket page.

## A backup failed

1. Look in the R2 dashboard → `echoandaura-backups` → today's file. If
   it's there, the alert was about something else. Read the message.
2. Dokploy → the Postgres service → Backups → the backup's logs.
3. Look for R2 key problems (a rotated token that Dokploy doesn't have).
   Settings → S3 Destinations → `r2-backups` → **Test**.
4. When fixed, **Run** it by hand and confirm a new file appears.

## Disk above 80 %

[infra/SERVER.md § 17](infra/SERVER.md): see what grew with
`docker system df` and `du -sh /var/lib/docker /var/log /var/cache/apt`.
The Dokploy cleanup normally keeps images in check. **Never** prune
volumes. If the disk is still tight after cleanup, move to BengalCloud's
next plan.

## Payment verification is falling behind

The admin's verification queue is the list of orders waiting on a person.
An order that has its transaction ID submitted (`pending_verification`)
**does not expire**: its tickets stay held until someone approves or
rejects it. Only unpaid orders lapse after 24 hours. What a backlog costs
is buyers waiting for their tickets, and messages to the organizer.

- Agree a turnaround with Raj before launch. The risk register suggests
  about 4 hours.
- In event week, check the queue several times a day. Approve what matches
  the bKash statement, and reject with a reason what doesn't. Every
  decision is in the order's audit trail.

## Event night

**The day before**

- [ ] `/api/health` is ok, and the Better Stack monitors are green.
- [ ] No merges to `main` from now until the event is over. Every merge
      deploys.
- [ ] Verification queue empty. Last emails sent (no `email.failed` on
      recent orders).
- [ ] Admin → the event → **Check-in** → print the sheet **and** download
      `export.csv`: the backup if phones fail.
- [ ] Gate passes created for each door phone. Each phone opens `/door`
      with its pass and scans a test ticket.
- [ ] On each phone, load `/door` once, then switch to airplane mode: the
      scanner must still open and scan (offline mode, ADR-034/035).
- [ ] Phones charged, power banks, a spare phone.

**At the door**

- A ticket that won't scan: search by name or code on the scanner; the
  printed list is the last resort.
- Offline scans queue on the phone and sync when the signal returns.
  Keep the phone open on `/door` until it shows nothing waiting.
- "Already checked in": show the time and the gate of the first scan to
  the person. A copied QR is the usual cause.

**After**

- [ ] Every door phone has synced (the gate pass shows its offline scan count).
- [ ] Look at the check-in page: the conflicts list, if any (ADR-034).
- [ ] Revoke the gate passes.

## Dates to watch

| What                                | When                                     | Where                                |
| ----------------------------------- | ---------------------------------------- | ------------------------------------ |
| BengalCloud VPS renewal (1,599 BDT) | monthly, the 26th                        | BengalCloud client area              |
| Domain `echoandaura.com`            | _to fill in: registrar and renewal date_ | the registrar                        |
| Dokploy API key for GitHub deploys  | expires 2027-09-28; reminder 2027-08-28  | [infra/SECRETS.md](infra/SECRETS.md) |
