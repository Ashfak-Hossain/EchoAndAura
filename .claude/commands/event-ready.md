---
description: Event-night readiness for one event, from the RUNBOOK checklist with live read-only checks
argument-hint: <event slug>
---

How ready is the event **$ARGUMENTS** for its sale and its night? Read-only:
never change production (ADR-072). The checklist is `docs/RUNBOOK.md` →
Event night; read that section first, it is the source of truth.

1. **The event**, from production (booleans, dates and counts only; no buyer
   data):
   ```bash
   ssh -o BatchMode=yes echoandaura 'D=$(docker ps -q -f name=echoandaura-db | head -1); docker exec $D psql -U echoandaura -d echoandaura -At -F " | " -c "
   select e.status, e.starts_at at time zone '"'"'Asia/Dhaka'"'"',
     e.registration_opens_at at time zone '"'"'Asia/Dhaka'"'"', e.registration_closes_at at time zone '"'"'Asia/Dhaka'"'"',
     (select count(*) from orders o where o.event_id = e.id and o.status = '"'"'pending_verification'"'"'),
     (select count(*) from orders o where o.event_id = e.id and o.status in ('"'"'paid'"'"', '"'"'issued'"'"'))
   from events e where e.slug = '"'"'$ARGUMENTS'"'"'"'
   ```
   Columns: status, starts, registration opens, registration closes (all
   Asia/Dhaka), orders awaiting verification, orders paid or issued. No row
   → stop: the slug is wrong. Not `published` → ❌. From the dates, work out
   where today falls: before registration opens, during the sale, the day
   before, or event day.
2. **Live checks**: run `/prod-check` steps 1–4 (health, revision, server,
   queues). Failed jobs on `orders` before an event are a ❌: buyers may be
   missing ticket emails.
3. **Freeze**: in the last 7 days, list merges to main
   (`git log --first-parent --since=… origin/main`) and the Dokploy rule
   (no update within a week of the event).
4. **The rest of the checklist** (Dokploy backups, R2 files, gate phones,
   printouts, power banks) cannot be seen from here. List each item as
   **owner to confirm**, with where to look.

Report the checklist for the phase today falls in, plus anything from an
earlier phase still open: ✅ checked live, ❌ checked and failing,
☐ owner to confirm. End with the next three actions, in order.
