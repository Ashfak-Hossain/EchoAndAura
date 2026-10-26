---
description: Read-only health report of production (site, revision, server, queues, settings, TLS)
---

A read-only look at production. Change nothing: if something needs fixing,
give the owner the exact command (ADR-072; `guard-bash.sh` refuses writes).
Never print a settings value, a phone, an email or a secret: booleans and
counts only. Run the steps in parallel where they are independent.

1. **Health**: `curl -sS -m 10 https://echoandaura.com/api/health`. All four
   fields true. Anything false → the matching RUNBOOK section.
2. **Revision**: `curl -sS -m 10 https://echoandaura.com/api/deployment` →
   `revision`, `ready`. Then `git fetch -q origin` and compare with
   `origin/main`. Equal is ✅. Behind is ✅ only when every file changed since
   is non-runtime, so Deploy skipped it (ADR-067):
   ```bash
   R=<revision>; git merge-base --is-ancestor $R origin/main && git diff --name-only $R origin/main | node -e "
   import('./.github/scripts/deploy-select.mjs').then(({ isNonRuntimePath }) => {
     const runtime = require('fs').readFileSync(0, 'utf8').split('\n').filter((p) => p && !isNonRuntimePath(p));
     console.log(runtime.length ? 'runtime changes not deployed: ' + runtime.join(' ') : 'only non-runtime changes since');
   })"
   ```
   Runtime changes not deployed → look at the latest Deploy run
   (`gh run list --workflow deploy.yml --limit 3`).
3. **Server** (one ssh, reads only):
   ```bash
   ssh -o BatchMode=yes echoandaura '
     docker ps --format "{{.Names}}: {{.Status}}" | grep -E "echoandaura|dokploy"
     df -h / | tail -1; free -m | sed -n 2,3p; swapon --show --noheadings
     test -f /var/run/reboot-required && echo "restart-required: yes" || echo "restart-required: no"'
   ```
   Web and worker `Up … (healthy)`; disk under 80 % (RUNBOOK → Disk above
   80 %); swap in use is a warning on a 4 GB machine.
4. **Queues** (through the worker, reads only):
   ```bash
   ssh -o BatchMode=yes echoandaura 'W=$(docker ps -q -f name=echoandaura-app-5nuhfn-worker | head -1); docker exec -w /app $W node --input-type=module -e "
   import { Queue } from \"bullmq\";
   const connection = { url: process.env.REDIS_URL };
   for (const name of [\"orders\", \"holds\", \"relay\"]) {
     const q = new Queue(name, { connection });
     const counts = await q.getJobCounts(\"waiting\", \"active\", \"delayed\", \"failed\");
     const schedulers = (await q.getJobSchedulers()).map((s) => s.key);
     console.log(name, JSON.stringify(counts), schedulers.join(\",\") || \"-\");
     await q.close();
   }"'
   ```
   Expect the `worker.ping` scheduler on `orders` and `expire-holds` on
   `holds`. Failed jobs above 0 → name the queue and say how many; do not
   retry or remove them.
5. **Settings** (booleans only):
   ```bash
   ssh -o BatchMode=yes echoandaura 'D=$(docker ps -q -f name=echoandaura-db | head -1); docker exec $D psql -U echoandaura -d echoandaura -At -F " " -c "select count(*) = 1, bool_and(bkash_receive_number ~ '"'"'^01[3-9][0-9 ]{8,10}$'"'"'), bool_and(bkash_account_name is not null), bool_and(support_email like '"'"'%@%'"'"' and support_email not like '"'"'%example%'"'"'), bool_and(support_phone is not null) from settings"'
   ```
   In order: the row is saved, the bKash number looks like a real mobile
   number, its account name, the support email and the support phone are set.
   Any `f` → Admin → Settings.
6. **TLS**: `echo | openssl s_client -connect echoandaura.com:443 -servername echoandaura.com 2>/dev/null | openssl x509 -noout -enddate`.
   More than 14 days left.
7. **Restore drill** (reads the repo, not production): the newest row of the
   drill log in `docs/RUNBOOK.md` → Restore drill, read with
   `git show origin/main:docs/RUNBOOK.md`. ✅ when it is ✓ and at most 31 days
   old; ⚠️ when older, ✗, or `–` (a check was skipped after a deploy: it
   proves less, so it doesn't count as a pass); ❌ when the log is empty. The
   fix is always `aws login --profile echoandaura && pnpm backup:drill`
   (ADR-088).

Report one table, one row per step: ✅ / ⚠️ / ❌ and a short reason. End with
what, if anything, the owner should do, as exact commands or clicks.
