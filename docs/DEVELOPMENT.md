# Development Guide

Status: ACTIVE · Owner: unassigned · Last updated: 2026-09-15

How to set up, run, test, and contribute to echoandaura.

---

## Prerequisites

- **Node 26** (see `.nvmrc` — `nvm use` or `fnm use`)
- **pnpm 11** (`corepack enable`)
- **Docker** (local Postgres + Redis)

## Getting started

```bash
pnpm install
cp .env.example .env            # then fill in real values
docker compose up -d            # Postgres 17 + Redis 7
pnpm db:migrate                 # apply migrations
pnpm admin:create               # the admin login
pnpm db:seed                    # realistic demo data (see "Demo data" below)
pnpm dev                        # http://localhost:3000
```

## Demo data

`pnpm db:seed` builds five Dhaka events — one open with ~60 orders, one
closing soon with a **private venue**, one sold out, one not open yet, one
past and archived — plus ~155 orders in every state (issued, awaiting
verification, awaiting payment with one hold ending within 2 hours,
rejected, expired, a cancelled ticket, comps) and the promo codes DHAKA15,
VIP500 and EARLYFRIENDS. It also adds eight sponsors across the three
levels (one hidden, one on a dark tile, one without a website) with
generated SVG wordmark logos, and the open event is "Presented by" the
presenting partner. Dates are relative to today, so it never goes stale;
covers are generated (sharp). Everything goes through the real
services, so every counter and audit row is genuine; only the timestamps
are backdated so reports show weeks of history. Buyers are `@example.com`
and email hooks are off — nothing is ever sent.

- `pnpm db:seed` — adds whatever is missing; an event already seeded is
  skipped with its orders, a sponsor with the same name is kept.
- `pnpm db:seed --reset` — first **empties** events, ticket types, orders,
  tickets, promo codes, gate passes, door scans and sponsors, and removes
  their cover and logo objects (users, sessions and settings stay). Refused
  unless the database is local and not `_e2e`, and `APP_ENV`/`NODE_ENV`
  are not production or staging (`scripts/seed/guard.ts`).
- Settings are written only when none are saved yet.
- Needs Postgres and MinIO running (`docker compose up -d`).

Run the background worker (email, expiry jobs) in a second terminal:

```bash
pnpm worker
```

## Environment

All configuration is read from `.env` (git-ignored). Start from `.env.example`,
which documents every variable — database, Redis, better-auth, Resend, R2, and
the organizer's bKash number. Never commit real secrets; a Write/Edit hook blocks
obvious ones. See [ENVIRONMENT.md](ENVIRONMENT.md) for every variable and how to
obtain each.

## Scripts

| Script                     | Purpose                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                 | Next.js dev server                                                                                                                                                        |
| `pnpm build` / `start`     | Production build / serve                                                                                                                                                  |
| `pnpm typecheck`           | `next typegen` + `tsc --noEmit`                                                                                                                                           |
| `pnpm lint`                | ESLint                                                                                                                                                                    |
| `pnpm format`              | Prettier                                                                                                                                                                  |
| `pnpm test`                | Unit tests (Vitest)                                                                                                                                                       |
| `pnpm test:integration`    | Integration tests — requires Docker Postgres + MinIO                                                                                                                      |
| `pnpm test:integration:db` | Postgres-only subset (inventory + concurrency); what CI runs                                                                                                              |
| `pnpm test:e2e`            | Playwright against a production build on :3100 and its own database (`<DATABASE_URL name>_e2e`, created/migrated/wiped/seeded each run; override with `E2E_DATABASE_URL`) |
| `pnpm db:generate`         | Generate a Drizzle migration from the schema                                                                                                                              |
| `pnpm db:migrate`          | Apply migrations                                                                                                                                                          |
| `pnpm db:studio`           | Drizzle Studio                                                                                                                                                            |
| `pnpm db:seed [--reset]`   | Realistic demo data through the real services; `--reset` empties events/orders first (dev database only) — see "Demo data"                                                |
| `pnpm worker`              | BullMQ worker: expire-holds every minute + the four transactional emails. Needs Redis                                                                                     |
| `pnpm jobs:expire-holds`   | Run the hold-expiry once and exit (ops / manual check)                                                                                                                    |
| `pnpm worker:build`        | Bundle the worker to `dist/worker.mjs` (esbuild); `pnpm worker` does this first                                                                                           |
| `pnpm email:render`        | Render the four emails with sample data to `tmp/emails/preview-*.html`                                                                                                    |
| `pnpm email:test <to>`     | Send one test message through the configured mailer (`MAILER=ses` to prove SES)                                                                                           |
| `pnpm infra:check`         | Read-only audit of AWS, DNS, SES and local services against `docs/infra/` (needs `aws login`)                                                                             |
| `pnpm verify`              | **The gate:** typecheck + lint + test + build                                                                                                                             |

## Testing

- **Unit** (`pnpm test`) — pure logic, no external services. Part of `pnpm verify`.
- **Integration** (`pnpm test:integration`) — runs against the real
  `docker compose` stack. Loads `.env`; the vitest integration project
  points `DATABASE_URL` at `TEST_DATABASE_URL`, so the code under test and
  the test's own seeding hit the same database (`echoandaura_test`) and the
  dev database is never touched. Includes
  `tests/integration/inventory.concurrency.test.ts`, which proves inventory
  reservation never oversells under concurrency; it must never be skipped or
  weakened. CI runs the Postgres-only subset (`test:integration:db`); the
  storage test needs MinIO and is local-only until CI gets one.
  `docker-compose.yml` only creates the dev database — create the test one
  once with `docker compose exec postgres createdb -U <user> echoandaura_test`
  (each DB-touching test file migrates it itself).
- **E2E** (`pnpm test:e2e`) — Playwright against a **production build** on
  port 3100 (`pnpm build && pnpm start -p 3100`, started by Playwright
  itself). Not the dev server: `next dev` degrades under parallel
  server-action load after HMR churn, which made the suite flaky. Needs
  Docker (Postgres + MinIO) and a seeded admin; `.env` is loaded by
  `next start`. Your `pnpm dev` on :3000 can keep running alongside.

Every service gets unit tests; money and state-machine functions must cover the
failure path, not just the happy path.

### The gate scanner on a real phone

The door page (`/door`, [ADR-030](DECISIONS.md)) needs the camera, and
phones only allow it on HTTPS with a real certificate. `next dev
--experimental-https` is not enough: its certificate is for `localhost`
only, and the phone reaches your laptop by another name. Use a Cloudflare
quick tunnel instead (free, no account):

1. `brew install cloudflared`, then with `pnpm dev` running:
   `cloudflared tunnel --url http://localhost:3000`. It prints an address
   like `https://<random>.trycloudflare.com`.
2. For that session, set `SITE_URL` and `BETTER_AUTH_URL` in `.env` to the
   tunnel address and restart `pnpm dev` (gate-pass QR codes and admin
   sign-in use them). Put them back afterwards.
   `*.trycloudflare.com` is already in `allowedDevOrigins` (dev only).
3. On the laptop, open the tunnel address → admin → an event → Check-in
   list → **New gate pass**. Scan the pass QR with the phone and open it in
   Safari or Chrome (not inside Messenger).
4. Check on an Android phone (Chrome) and an iPhone (Safari): a ticket QR
   shown on another screen decodes; the torch toggles; locking the phone
   and coming back shows **Tap to resume**; the iPhone still beeps with
   the ringer on silent.

Before doors open (4 h before the start) a pass is in **practice** (blue
banner): scans answer but check nothing in, so testing with real tickets at
home is safe. Every seeded event is days away, so steps 1–4 all run in
practice. To see the real answers — green ADMIT, amber "at this gate", red
ALREADY IN from a second phone, name search with the phone digits, Undo —
open one event's **Details** tab and set **Starts at** to an hour ago and
**Registration closes** to before that (a started event never becomes the
home-page hero). Put it back afterwards, or re-seed with
`pnpm db:seed --reset`.

## The quality gate

`pnpm verify` runs typecheck → lint → unit tests → build. **Nothing merges unless
it passes**, locally and in CI (`.github/workflows/ci.yml`).

Builds write to `.next-build/`, the dev server to `.next/` (`NEXT_DIST_DIR`
in the `build`, `start` and `typecheck` scripts; `distDir` in
`next.config.ts`). That is what lets `pnpm verify` and the Playwright suite
run while `pnpm dev` is up: sharing one folder corrupts Turbopack's dev
cache ("Restore of All for task … failed") and the dev typegen. If the dev
server ever dies that way anyway, `rm -rf .next` and start it again.

## Project structure

```
src/
  app/            # Next.js App Router — (public) and (admin) routes, api/
  components/     # React components; components/ui is shadcn-generated
  db/             # Drizzle schema + client
  server/         # All business logic — imports no next/*
    services/     # Business logic (e.g. fulfilment, inventory)
    repositories/ # Data access — owns Drizzle queries
    lib/          # money.ts and other pure helpers
  emails/         # React Email templates
  jobs/           # Queue job definitions
  worker.ts       # BullMQ worker entrypoint
drizzle/          # Generated migrations — never hand-edited
tests/            # unit / integration / e2e
scripts/          # seed and one-off scripts
```

Key rule: `src/server/**` holds all business logic and imports no `next/*`, so the
worker can reuse it directly. Route handlers and server actions stay thin (parse →
call a service → map the result).

## Branching & commits

- One branch per feature or phase (`feat/…`, `phase/N-…`); PR into `main`.
- `main` is always deployable; CI must be green to merge.
- **Conventional commits:** `feat(events): add ticket type editor`,
  `fix(orders): …`, `chore: …`.
- Commit at each green slice, not at end of day — small commits bisect well.
- Tag each deploy (`v0.3.0`) and add a `CHANGELOG.md` entry.

## Definition of Done

A change is done when all of these hold:

- [ ] `pnpm verify` passes
- [ ] Tests cover the failure path, not only the happy path
- [ ] No `any`, no `@ts-ignore`, no skipped tests
- [ ] Zod validation on every external input
- [ ] Errors are handled and logged (pino) with the order reference in context
- [ ] Loading and empty states exist in the UI, and it works at 360px wide
- [ ] Code review passed (see below)

## Code review & the invariants

This is a payment-handling codebase. Before merging any change that touches money,
inventory, orders, or fulfilment, review it against the seven invariants in
[../CLAUDE.md](../CLAUDE.md): integer-paisa money, the atomic inventory UPDATE,
database-enforced transaction-ID uniqueness, single-path fulfilment, server-side
prices, the append-only audit trail, and no network calls inside a DB transaction.
These are the points an "idiomatic simplification" tends to break.

## Further reading

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design and data model
- [DIAGRAMS.md](DIAGRAMS.md) — ER, class, state, and sequence diagrams
- [ENVIRONMENT.md](ENVIRONMENT.md) — environment variables and how to get them
- [../CLAUDE.md](../CLAUDE.md) — the invariants, in full
- [DECISIONS.md](DECISIONS.md) — architecture decision records
