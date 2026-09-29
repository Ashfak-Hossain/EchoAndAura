# Load test

Status: ACTIVE · Owner: Evan · Last run: 2026-09-30 (Phase 7.5)

How much traffic the production server can take, measured before the
first event. Re-run it after a big change to the public pages, the order
flow, or the server size.

## Summary

| Question                                               | Answer (production, estimated)                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Page views per second with instant pages (p95 < 50 ms) | **about 9** (over 30,000 an hour)                                                                 |
| Where response times start to grow                     | **about 18** views per second                                                                     |
| The most it can serve                                  | **about 35** views per second; beyond that, requests queue for seconds                            |
| When it falls over                                     | **about 70–100** views per second, sustained: the web process runs out of heap and restarts       |
| 200 buyers for 100 seats at the same moment            | **exactly 100 holds, 100 "sold out", 0 errors, 0 oversold**; all done in about 9 s, p95 about 4 s |

For scale: a launch for an event this size is a few page views per second
at its peak. The server has several times that in reserve, and the order
flow stays correct under a rush (the atomic hold, invariant 2).

## How it was measured

- **The production web image, built from the same Dockerfile** for the
  laptop's CPU (arm64). The GHCR images are amd64, and running them under
  emulation would have made every number meaningless.
- **Squeezed to the server's size:** web, Postgres and Redis pinned to the
  **same two cores** (`cpuset: '0,1'`), with the production memory limits
  (web 1 GB, Postgres 1 GB, Redis 256 MB). The load generator (k6) ran on
  the laptop's other cores, so it took no CPU from the "server".
- **Realistic data:** the dev seed (five events, about 150 orders, eight
  sponsors) plus a published test event with 100 seats and registration
  open.
- **No worker:** in production mode it insists on real SES and would have
  emailed every test order. Registrations queue their emails in Redis, as
  on the server; the worker's own CPU use is small next to the web's.
- **Page views are HTML only.** k6 doesn't fetch images, scripts or
  styles; Cloudflare and browser caches serve those in production.
- **Scaled to the server** with a CPU benchmark (`ops/load/bench.js`, the
  same JavaScript on one core of each): laptop about 480 ms, server about
  1,070 ms. **Server numbers are laptop numbers ÷ 2.2.** The server also
  runs Dokploy and Traefik, so treat the estimates as ceilings.

## Results (laptop, two cores)

**Public pages** (`read.js`): a launch mix of event page 5, home 3,
register 2, events list 1. One minute at each steady rate:

| Views/s asked | Served/s | Failed | Median | p95    | p99    | Max    |
| ------------- | -------- | ------ | ------ | ------ | ------ | ------ |
| 5             | 5        | 0 %    | 28 ms  | 82 ms  | 170 ms | 388 ms |
| 10            | 10       | 0 %    | 23 ms  | 31 ms  | 39 ms  | 63 ms  |
| 20            | 20       | 0 %    | 13 ms  | 28 ms  | 93 ms  | 347 ms |
| 40            | 40       | 0 %    | 10 ms  | 188 ms | 700 ms | 870 ms |
| 60            | 60       | 0 %    | 10 ms  | 373 ms | 661 ms | 831 ms |
| 80            | 79       | 0 %    | 9 ms   | 461 ms | 1.3 s  | 1.5 s  |
| 120           | 72       | 0 %    | 12.5 s | 21 s   | 21 s   | 22 s   |
| 160           | 35       | 30 %   | 20 s   | 60 s   | 60 s   | 60 s   |
| 220           | 88       | 100 %  | —      | 24 s   | 57 s   | 59 s   |

The web process is the limit, not the database: at saturation Postgres
used under 10 % of a core while the web used about 1.4.

**At 220 views/s the web process crashed:** `JavaScript heap out of
memory`. Node gives itself half the container's memory as heap (about
512 MB of the 1 GB limit), and requests queued under overload filled it.
In production Docker restarts the container at once
(`restart: unless-stopped`); the site was already unusable at that load
before the crash.

**The on-sale rush** (`register.js`): 200 buyers submit the real form at
the same moment, the way a browser without JavaScript does, for 100 seats:

| Holds | "Sold out" | Errors | Submit median | Submit p95 | Submit max | Whole rush |
| ----- | ---------- | ------ | ------------- | ---------- | ---------- | ---------- |
| 100   | 100        | 0      | 1.2 s         | 1.9 s      | 2.1 s      | 4 s        |

`check.sql` afterwards: 100 seats, 100 held, 0 left over, 100 orders in
`pending_payment`, 100 audit rows. No oversell.

**Production, gently** (through Cloudflare, read-only, 3 views/s for 30 s
on `/`, `/events`, `/faq`): 91 requests, 0 failed, median 90 ms, p95
263 ms. That includes the round trip to Cloudflare's edge.

## Findings

- **Launch day is well inside capacity.** Nothing needs changing before
  the first event.
- **The failure mode under a flood is a crash and restart,** not slow
  death: requests queue until the heap fills. A Cloudflare rate-limiting
  rule would turn a single-source flood into fast refusals instead
  (Phase 7.6 decides).
- **The order flow is safe under a rush.** The conditional atomic UPDATE
  (invariant 2) handed out exactly 100 holds to 200 simultaneous buyers.

## Running it again

```sh
# 1. The web image, for this machine's CPU
docker build --target web --build-arg R2_PUBLIC_URL=https://media.echoandaura.com -t echoandaura-web:load .

# 2. The stack (web, Postgres, Redis on two shared cores), its data
docker compose -f ops/load/docker-compose.yml up -d postgres redis
export DATABASE_URL=postgresql://load:load@localhost:55432/echoandaura_load
pnpm exec dotenv -e .env -- tsx ops/load/prepare.ts   # migrate + the 100-seat event
pnpm db:seed                                          # realistic data (guarded: local only)
docker compose -f ops/load/docker-compose.yml up -d web

# 3. The tests (results also land in ops/load/results/, git-ignored)
docker compose -f ops/load/docker-compose.yml run --rm k6 run /scripts/register.js
docker compose -f ops/load/docker-compose.yml exec -T postgres psql -U load -d echoandaura_load < ops/load/check.sql
for r in 5 10 20 40 60 80; do
  docker compose -f ops/load/docker-compose.yml run --rm k6 run -q -e RATE=$r /scripts/read.js
done

# 4. Clean up
docker compose -f ops/load/docker-compose.yml down -v
```

The rush uses up the event's seats, so run `register.js` on a fresh stack
(`down -v`, then step 2 again). **Never point these scripts at production.**
The only production check is the gentle one above:
`-e BASE_URL=https://echoandaura.com -e PATHS=/,/events,/faq -e RATE=3 -e DURATION=30s`.

To re-calibrate after a server change, run `ops/load/bench.js` on both
machines: on the laptop with
`docker run --rm --cpuset-cpus 0 -v "$PWD/ops/load:/b:ro" --entrypoint node echoandaura-web:load /b/bench.js`,
on the server by piping it into `docker exec -i <web container> node -`.
