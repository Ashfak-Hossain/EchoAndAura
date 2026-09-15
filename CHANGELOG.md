# Changelog

All notable changes to this project are documented here, newest first.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).
Entries are added at tag time per [docs/DEVELOPMENT.md § Branching & commits](docs/DEVELOPMENT.md).

## [Unreleased]

### Phase 0 — Foundation (2026-09-15)

Scaffolded and verified; not yet tagged.

- Next.js 16 / React 19 / Node 26 / TypeScript strict; Tailwind 4 + shadcn/ui.
- Drizzle schema + initial migration `0000_abandoned_rage.sql`; docker-compose
  (Postgres 17, Redis 7).
- `src/server/lib/money.ts` (integer paisa) with unit tests; inventory
  reservation stub (real atomic UPDATE lands in Phase 3).
- Vitest (unit + integration) including the inventory concurrency test;
  Playwright config; GitHub Actions CI running `pnpm verify`.
- Postgres driver: postgres-js. All dependencies pinned to exact versions.
- `pnpm verify` green.
