# Runbook

Status: ACTIVE · Owner: Evan · Last updated: 2026-10-02

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

**Over live data** (a bad migration, a wrong bulk change). **Rehearsed
on 2026-09-29** on scratch databases: about 5 minutes end to end, almost
all of it getting the backup from R2 onto the server; the dump, the
restore, the grants and the swap took seconds each (a small database; it
grows with the orders). It loses everything written since that backup,
so first decide whether fixing forward is cheaper.

1. **Stop writes.** Dokploy → the compose app → **Stop**. Web and worker
   go down, and Better Stack will alert: expected. This is also what lets
   step 4 work: Postgres refuses to rename a database anyone is
   connected to ("is being accessed by other users").
2. **Keep what is there now.** It holds the orders placed since the
   backup. `umask 077` makes the file readable by root only, since it
   holds buyer data:
   ```sh
   C=$(docker ps -q -f name=echoandaura-db-ljctqy | head -1)
   umask 077
   docker exec $C pg_dump -U echoandaura -d echoandaura -Fc > ~/pre-restore-$(date +%F-%H%M).dump
   ls -lh ~/pre-restore-*.dump      # -rw------- root
   ```
3. **Get the backup onto the server.** Cloudflare → R2 →
   `echoandaura-backups` → `echoandaura-db-ljctqy/postgres/` → the
   chosen file → Download. The download is named with its folder in
   front, e.g. `echoandaura-db-ljctqy_postgres_2026-09-28T21-00-00-188Z.sql.gz`.
   From the laptop: `scp ~/Downloads/<that file> echoandaura:`. Then, on
   the server, restore it into a **new** database:

   ```sh
   B=~/echoandaura-db-ljctqy_postgres_<timestamp>.sql.gz
   chmod 600 $B
   docker exec $C psql -U echoandaura -d postgres -c 'CREATE DATABASE echoandaura_restore'
   gunzip -c $B | docker exec -i $C pg_restore -U echoandaura -d echoandaura_restore --no-owner --no-acl --exit-on-error
   docker exec $C psql -U echoandaura -d echoandaura_restore \
     -c 'select (select count(*) from users) as users, (select count(*) from orders) as orders, (select count(*) from drizzle.__drizzle_migrations) as migrations'
   ```

   `pg_restore` prints nothing when it works. Check the counts look like
   the date of the backup.

   Give the app's role its rights on the restored copy. `--no-acl` above
   left the backup's grants out; they come from the repo instead
   (ADR-044). Without this step the app can't read a single table:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/Ashfak-Hossain/EchoAndAura/main/ops/db/app-role.sql \
     | docker exec -i $C psql -v ON_ERROR_STOP=1 -U echoandaura -d echoandaura_restore
   docker exec -it $C psql -h localhost -U echoandaura_app -d echoandaura_restore -c 'select count(*) from users'
   ```

   The last command asks for the app role's password (Bitwarden
   `Postgres app role (prod)`) and must print a count.

4. **Swap the names.** As the owner, `echoandaura` (a superuser); the
   app's own role (`echoandaura_app`, ADR-044) can't rename databases.
   The app role's rights belong to the database, not its name, so they
   move with it:
   ```sh
   docker exec $C psql -U echoandaura -d postgres \
     -c "ALTER DATABASE echoandaura RENAME TO echoandaura_broken_$(date +%Y%m%d)" \
     -c 'ALTER DATABASE echoandaura_restore RENAME TO echoandaura'
   docker exec $C psql -U echoandaura -d postgres -c '\l echoandaura*'
   ```
5. Dokploy → the compose app → **Deploy**. Check `/api/health`, the
   admin, one order.
6. **Reconcile** the orders placed between the backup and the incident.
   They are in `echoandaura_broken_…` and in the pre-restore dump. Check
   them against the bKash statement. Buyers have their order emails.
7. **Clean up** after a week, once nobody needs them. They hold buyer
   data. Also delete the download from the laptop.
   ```sh
   docker exec $C psql -U echoandaura -d postgres -c 'DROP DATABASE echoandaura_broken_<date>'
   rm ~/pre-restore-*.dump ~/echoandaura-db-ljctqy_postgres_*.sql.gz
   ```

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

## The site is under attack

Signs: the uptime alert, many 429s, Cloudflare → Security → Events
filling up, buyers saying the site won't load.

1. **Look first:** Cloudflare → Security → Analytics / Events. Where does
   the traffic come from (country, a few addresses, one path)?
2. **Mostly from abroad:** Security → WAF → Custom rules → switch
   `emergency - outside Bangladesh` **on** (ADR-050). Visitors outside
   Bangladesh get a Cloudflare check first; buyers at home don't notice.
3. **From everywhere / not easing:** Overview → **Under Attack Mode** on.
   Every visitor gets a few-second check, including Bangladesh. Door
   phones that already loaded `/door` keep scanning offline (ADR-034).
4. **One path hammered** (e.g. a single page): a temporary custom rule
   blocking or challenging that path. The free plan has 5 rules; we use 3.
5. **When it is over:** switch the emergency rule and Under Attack Mode
   **off** again (they cost diaspora buyers a check), and write what
   happened in [infra/CLOUDFLARE.md](infra/CLOUDFLARE.md) History.

What already holds without you: Cloudflare's DDoS protection, the
per-address rate limit (ADR-047), the in-flight cap that refuses instead
of crashing, Turnstile on the forms (ADR-048), origin lockdown (ADR-045).

## Nobody can get into /admin (Cloudflare Access)

Cloudflare's email page comes before the sign-in page (ADR-050).

- **The code email doesn't arrive:** it comes from Cloudflare
  (`noreply@notify.cloudflare.com`), not from us: check spam. The address
  must be on the `Admin` app's `admins` policy, exactly as typed.
- **A bare `Forbidden` page after the email code:** the web refused the
  token. `CF_ACCESS_AUD` in Dokploy must be the `Admin` app's AUD tag and
  `CF_ACCESS_TEAM_DOMAIN` the team domain.
- **Raj changed email or lost access to it:** add the new address to the
  policy ([infra/CLOUDFLARE.md § Change it later](infra/CLOUDFLARE.md#change-it-later)).
- **Everything is broken and the event is tonight:** empty
  `CF_ACCESS_AUD` in Dokploy → Deploy, and delete the `Admin` app.
  Password + 2FA still protect the console; put Access back after.

## Buyers say the bot check fails

They see "We couldn't confirm you're not a bot" on registration, Find my
order, sign-in, admin login or forgot password (Turnstile, ADR-048).

1. **One buyer:** ask them to refresh the page and try again, or another
   browser. A strict content blocker or VPN can stop Cloudflare's
   script; the form then says the check could not load.
2. **Everyone:** read the web's log for the reason:

   ```sh
   docker logs --since 30m echoandaura-app-5nuhfn-web-1 2>&1 | grep turnstile
   ```

   | Log line                                                                                         | Meaning                                                                                                                                                                                 | Do                                                                                                                                   |
   | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
   | `turnstile secret rejected by Cloudflare`                                                        | our `TURNSTILE_SECRET_KEY` is wrong or was rotated away. **Every submit fails**                                                                                                         | Compare Dokploy's value with Bitwarden `Cloudflare Turnstile`; if lost, [rotate it](infra/CLOUDFLARE.md#rotate-the-turnstile-secret) |
   | `turnstile check refused`, `hostname-mismatch`                                                   | the token was solved on a host other than `SITE_URL`'s                                                                                                                                  | Turnstile → `echoandaura forms` → Hostname management must list `echoandaura.com`; `SITE_URL` must be `https://echoandaura.com`      |
   | `turnstile check refused`, `missing`                                                             | no token reached the server: the widget did not load or run                                                                                                                             | [Cloudflare status](https://www.cloudflarestatus.com) (Turnstile, challenges); the site key in Dokploy matches the widget's          |
   | `turnstile check refused`, `rejected`                                                            | Cloudflare refused the token (expired, used twice, or a bot)                                                                                                                            | Normal in small numbers. Many from real buyers: check the widget's analytics in Cloudflare                                           |
   | `turnstile siteverify unavailable — allowing`                                                    | Cloudflare could not be asked; submits are **let through** (by design)                                                                                                                  | Nothing to fix here; the rate limits still hold. Watch Cloudflare status                                                             |
   | `turnstile check refused`, `action-mismatch`                                                     | the token was solved for another form: a widget's `action` and its server action's `TurnstileAction` differ after a code change (that whole form fails), or someone is replaying tokens | One form failing for everyone: a code bug, roll back the deploy. Scattered: ignore                                                   |
   | `turnstile siteverify answered in an unknown shape — allowing`, or `… internal error — allowing` | as `unavailable`: submits are **let through**                                                                                                                                           | As `unavailable`                                                                                                                     |

3. After any change to a key: Dokploy → **Deploy**, then the check in
   [DEPLOY.md → Bot check keys](DEPLOY.md#bot-check-keys-adr-048).

There is no switch to turn the check off: test keys are refused in
production. If Turnstile itself is down for days, the fix is a code
change (ADR-048, Revisit when).

## An admin lost their phone

Every admin signs in with a password and a code from an authenticator
app (ADR-049). Without the phone:

1. **To get in today: a backup code.** On the code page, **Use a backup
   code instead**, and type one of the 10 codes saved at setup. Each
   works once. A backup code only gets them in: the console has no "add
   a new phone". Moving to a new phone always takes the reset below,
   then setup; until then every sign-in uses up another code.
2. **If the phone was stolen** (or might have been), change the password
   **first**, before the reset: the phone may hold the saved password
   too, and right after a reset the password alone reaches the setup
   page, where a thief could enrol their own phone. Sign the stolen phone
   out of the admin's email account (Google → Security → Your devices),
   then either **Your account** → Password (signed in with a backup code)
   or **Forgot password?** on `/admin/login`. Both sign out every other
   device. Lost, not stolen: skip to step 3.
3. **Reset their two-factor on the server.** It deletes their
   authenticator secret and backup codes and signs them out everywhere;
   the password stays. Confirm it is really them first (a call, not an
   email: the email account may be what was taken):

   ```sh
   # on the server (ssh echoandaura), or Dokploy → worker → Terminal
   # without the `docker exec …-worker-1` prefix:
   docker exec echoandaura-app-5nuhfn-worker-1 \
     node dist/ops/admin-reset-2fa.mjs raj@example.com
   ```

   It answers `Two-factor reset for raj@example.com. They must set it up
again at their next sign-in.` It refuses an unknown address and a
   buyer's (exit 1, nothing changed). Locally: `pnpm admin:reset-2fa
<email>`.

4. They sign in with their password **right away** and are sent
   straight to setup: a new QR code and 10 new backup codes. Until they
   enrol, the password alone reaches the setup page. Turning two-factor
   on signs out every other session of theirs, so a session someone
   opened in that window does not survive it.

**The code page says the account is locked:** 10 wrong codes in a row
lock it for 15 minutes (better-auth's lockout). Wait it out. If nobody
at our end was typing those codes, someone else has the password:
change it.

## Two-factor codes are always wrong

The code is what the phone shows, but the site refuses it every time.
Codes are made from the time, and only one 30-second step either side
is accepted, so one of the two clocks is off, or the code comes from
the wrong entry.

1. **The wrong entry:** the app may hold two `echoandaura` entries.
   Running setup's first step again (a reload, a second tab) makes a new
   secret, and an entry scanned before that never works. At sign-in, use
   the entry added last and delete the other; during setup, delete the
   old one and scan the code on the page now.
2. **The phone:** Settings → Date & time → set automatically (and the
   time zone automatically). Then try a fresh code.
3. **The server:** `timedatectl` must show
   `System clock synchronized: yes` and `NTP service: active`
   ([infra/SERVER.md § 5](infra/SERVER.md)). If not,
   `timedatectl set-ntp true` and check again a minute later.
4. Still refused: the account may be locked (above), or that sign-in
   has run out. Each one allows 10 minutes and 5 codes; after that,
   start again from the password (the sign-in page says which: "timed
   out" or "too many wrong codes").

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
- [ ] No Dokploy update since a week before the event (see
      [Updating Dokploy](#updating-dokploy)).
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

## Updating Dokploy

Dokploy shows "New version available" on its dashboard. It runs the
deploys, the backups and the alerts, so an update is a change to
production even though the site keeps running while the panel restarts.

- **Read the release notes first** (the link in the dialog, or
  `gh release view <version> -R Dokploy/dokploy`).
- **Update only for a reason:** a security fix, or a fix to something
  used here (deploys, backups, notifications, Traefik, Docker cleanup).
  A release with nothing for us waits for the next one. (2026-09-29:
  v0.30.8 was one HubSpot chat-widget fix; skipped.)
- **Never in event week** (from 7 days before an event until it is over).
- **When you do:** at a quiet hour, right after a successful nightly
  backup. Afterwards: the dashboard opens, `/api/health` is ok, and
  Notifications → **Test** reaches the alert group. Add a row to
  [infra/SERVER.md](infra/SERVER.md) → History.

## Dates to watch

| What                                | When                                     | Where                                |
| ----------------------------------- | ---------------------------------------- | ------------------------------------ |
| BengalCloud VPS renewal (1,599 BDT) | monthly, the 26th                        | BengalCloud client area              |
| Domain `echoandaura.com`            | _to fill in: registrar and renewal date_ | the registrar                        |
| Dokploy API key for GitHub deploys  | expires 2027-09-28; reminder 2027-08-28  | [infra/SECRETS.md](infra/SECRETS.md) |
