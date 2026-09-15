# Progress Log

Updated at the end of every session by `/wrap`. Newest entry at the top.

**Current phase:** Phase 1 — Admin & events (Phase 0 complete)
**Next slice:** better-auth admin login
**Blocked on:** domain name (Resend/email, Phase 4); bKash merchant account (scale, not launch)

---

### 2026-09-15 — Phase 0 (Foundation) — COMPLETE

**Done:**

- Scaffolded Next.js 16 into the existing repo (kept docs + authoritative
  `CLAUDE.md`; `AGENTS.md` hosts Next's managed agent block so `CLAUDE.md` is
  never rewritten by `next dev`).
- Drizzle schema (events, ticket_types, orders, order_events, promo_codes,
  tickets) + migration `drizzle/0000_abandoned_rage.sql`. DB-enforced invariants
  verified: UNIQUE `orders.bkash_trx_id`, availability CHECK, quantity 1–10
  CHECK, bigint paisa.
- `src/server/lib/money.ts` (integer paisa) + 18 unit tests covering failure
  paths.
- `inventory.service.ts` typed stub — the real conditional atomic UPDATE is
  Phase 3.
- `docker-compose.yml` (postgres:17 + redis:7, both healthy); GitHub Actions CI
  runs `pnpm verify`.
- Vitest unit/integration split. The concurrency test is RED for the right
  reason (reservation unimplemented: expected 20 reserved, got 0) — it goes
  green in Phase 3 with no rewrite.
- Latest majors installed (Next 16, React 19, Node 26, Tailwind 4, drizzle-orm
  0.45 + postgres-js, Vitest 5). 44 deps pinned exact; lightningcss override for
  vite 8; peer-strictness loosened for React 19.
- `pnpm verify` green (typecheck, lint, 18 tests, build).

**Decisions:** ADR-003 — adopt latest majors at scaffold time (see DECISIONS.md).

**Next (Phase 1 — Admin & events):** better-auth admin login → event CRUD →
ticket-type CRUD → R2 image upload → publish/unpublish. First slice: admin login.

**Blocked:** domain name (blocks Resend email, Phase 4); bKash merchant account
(blocks scale, not launch).

---

## Template

### YYYY-MM-DD — Phase N

## **Done:**

## **Decisions:** (link to DECISIONS.md if an ADR was written)

## **Next:**

## **Blocked:**
