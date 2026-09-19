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
pnpm db:seed                    # optional sample data
pnpm dev                        # http://localhost:3000
```

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

| Script                     | Purpose                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| `pnpm dev`                 | Next.js dev server                                                         |
| `pnpm build` / `start`     | Production build / serve                                                   |
| `pnpm typecheck`           | `next typegen` + `tsc --noEmit`                                            |
| `pnpm lint`                | ESLint                                                                     |
| `pnpm format`              | Prettier                                                                   |
| `pnpm test`                | Unit tests (Vitest)                                                        |
| `pnpm test:integration`    | Integration tests — requires Docker Postgres + MinIO                       |
| `pnpm test:integration:db` | Postgres-only subset (inventory + concurrency); what CI runs               |
| `pnpm test:e2e`            | Playwright end-to-end                                                      |
| `pnpm db:generate`         | Generate a Drizzle migration from the schema                               |
| `pnpm db:migrate`          | Apply migrations                                                           |
| `pnpm db:studio`           | Drizzle Studio                                                             |
| `pnpm db:seed`             | Seed sample data                                                           |
| `pnpm worker`              | BullMQ worker (expire-holds every minute; Phase 4 adds email). Needs Redis |
| `pnpm jobs:expire-holds`   | Run the hold-expiry once and exit (ops / manual check)                     |
| `pnpm verify`              | **The gate:** typecheck + lint + test + build                              |

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

## The quality gate

`pnpm verify` runs typecheck → lint → unit tests → build. **Nothing merges unless
it passes**, locally and in CI (`.github/workflows/ci.yml`).

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
