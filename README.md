# echoandaura

Single-organizer event ticketing with manual bKash payment verification.

Public users browse events, register, and pay by bKash transfer. An admin
verifies each transaction against the bKash statement before tickets are issued
by email. There is no bKash API integration — the payment model and the
invariants that protect it are documented in [CLAUDE.md](CLAUDE.md).

## Stack

Next.js 16 · React 19 · Node 26 · TypeScript (strict) · Postgres 17 + Drizzle
(postgres-js) · Redis 7 + BullMQ · Zod · better-auth · pino · Resend + React
Email · shadcn/ui + Tailwind 4 · Vitest + Playwright · Docker.

## Quick start

See the [Development Guide](docs/DEVELOPMENT.md) for full setup. In short:

```bash
pnpm install
cp .env.example .env           # then fill in values
docker compose up -d           # Postgres + Redis
pnpm db:migrate && pnpm db:seed
pnpm dev                       # http://localhost:3000
```

`pnpm verify` (typecheck + lint + test + build) is the gate that must pass before
anything merges.

## Documentation

- [Development Guide](docs/DEVELOPMENT.md) — setup, scripts, testing, workflow
- [Architecture](docs/ARCHITECTURE.md) — system design, data model, data flow
- [Invariants](CLAUDE.md) — the money / inventory / payment rules that must never break
- [Decisions](docs/DECISIONS.md) — architecture decision records
- [Requirements](docs/REQUIREMENTS.md) — product scope
- [Changelog](CHANGELOG.md) — release history

---

Private project. Not licensed for reuse or redistribution.
