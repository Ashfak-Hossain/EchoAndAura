---
id: ADR-040
title: 'Monitoring: an outside check, one alert group, a worker heartbeat'
date: 2026-09-28
status: accepted
area: Infrastructure and deploys
supersedes: []
extends: []
---

# ADR-040 — Monitoring: an outside check, one alert group, a worker heartbeat

**Date:** 2026-09-28 · **Status:** Accepted

**Context:** Before the first event, a failure had to reach a person
without anyone watching a dashboard. Two gaps stood out:

- Nothing outside the server checked it. A check running on the server
  can't report that the server itself is down.
- `/api/health` checked Postgres and Redis but **not the worker**. With
  the worker dead, the site looked healthy while no email was sent and no
  lapsed hold was released.

**Decision:**

- **Better Stack's free plan** checks `/api/health` and the Dokploy
  dashboard every 3 minutes from four regions, and alerts by email.
  UptimeRobot's free plan describes itself as for hobby and non-profit
  use, and neither free plan can post to Telegram. Paying (about $7 a
  month) buys faster checks and Telegram, and can come later.
- **One Telegram group for everything else**, plus email:
  - Dokploy's own notifications: deploy, build error, database backup,
    restart.
  - An hourly systemd timer on the server for the disk (above 80 %,
    at most one message a day, one on recovery). Its files are in the
    repo (`ops/server/`), installed by hand.

  Dokploy's email goes through the developer's Gmail (SMTP with an app
  password), **not SES**, so alerts still arrive when SES is the thing
  that broke.

- **Worker heartbeat.**
  - The worker writes the time to Redis (`echoandaura:worker:heartbeat`)
    when it starts and at the start of every `expire-holds` run, once a
    minute, before the database work.
  - The health check reads it through its probe connection. It reports
    `worker: false`, and `ok: false`, when the heartbeat is more than
    3 minutes old (three missed runs), missing, or not a number.
  - The key expires on its own at 6 minutes.
  - Writing in the job, not on a timer, proves that scheduled jobs are
    picked up, not only that the process exists.
  - Writing at boot makes the health check green within seconds of a
    deploy, so the deploy smoke test, which retries `/api/health` for up
    to a minute, needs no change.

**Consequences:**

- A dead or stuck worker now pages someone: `/api/health` answers 503.
  The container health check stays on `?live`, so Traefik never drops a
  web container because of the worker.
- Worst-case detection is about 4 minutes (a 3-minute check plus 1-minute
  confirmation). A deploy restarts the worker in seconds, well inside
  the 3-minute allowance.
- No CPU or memory alert yet: Dokploy's thresholds need its monitoring
  agent, which costs RAM on a 4 GB server. No certificate or domain
  expiry check either: RUNBOOK.md lists the dates instead.

**Revisit when:** Telegram is wanted for outages too (a paid monitor), or
the server grows enough to run Dokploy's monitoring agent.
