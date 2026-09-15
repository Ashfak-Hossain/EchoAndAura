# echoandaura

Single-organizer event ticketing with manual bKash payment verification.

**Status:** Phase 0 — Foundation · Pre-launch · Target: registration open by
**11 September** (20 days before the 1 October event)

---

## What this is

Public users browse events, register, and pay via manual bKash transfer. An
admin verifies each transaction against the bKash statement before tickets
are issued by email. There is no bKash API integration — see
[CLAUDE.md](CLAUDE.md#payment-model--read-this-first) for the full payment
model and the invariants that protect it.

## Quick start

Scaffold, dependencies, and local services: [SETUP.md](SETUP.md).

```bash
pnpm dev            # http://localhost:3000
pnpm verify          # typecheck + lint + test + build — the merge gate
```

## Stack

Next.js 15 · Node 22 · TypeScript strict · Postgres 17 + Drizzle · Redis 7 +
BullMQ · Zod · better-auth · pino · Resend + React Email · shadcn/ui ·
Vitest + Playwright · Docker

`CLAUDE.md` is the authoritative version list — see
[CLAUDE.md § Stack](CLAUDE.md#stack).

## Documentation

Everything else — the invariants, the build plan, how sessions work, and
where each decision was recorded — is indexed in **[docs/README.md](docs/README.md)**.
Start there.

## Working with Claude Code

This codebase is built session-by-session with Claude Code, following the
loop in [docs/WORKFLOW.md](docs/WORKFLOW.md): `/prime` → plan → implement one
slice → `/verify` → `/wrap`. Read it before starting a session.

## Status

- Where things stand right now: [docs/PROGRESS.md](docs/PROGRESS.md)
- The phased build plan and exit criteria: [docs/PHASES.md](docs/PHASES.md)
- What shipped in each tagged release: [CHANGELOG.md](CHANGELOG.md)

---

Private client project. Not licensed for reuse or redistribution.
