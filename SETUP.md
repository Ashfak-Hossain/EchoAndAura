# Project Setup — Run These Commands

Everything below uses official CLIs. No boilerplate repos, no copied starters.
Run in order. Roughly 20 minutes.

Project name: `echoandaura` (confirmed). The domain is still open — see
[docs/REQUIREMENTS.md § Open decisions](docs/REQUIREMENTS.md).

---

## 1. Scaffold Next.js

```bash
pnpm create next-app@latest echoandaura \
  --typescript --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-pnpm

cd echoandaura
git init && git add -A && git commit -m "chore: scaffold next.js"
```

## 2. Runtime dependencies

```bash
# Database
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit

# Validation, auth, logging
pnpm add zod better-auth pino
pnpm add -D pino-pretty

# Queue
pnpm add bullmq ioredis

# Email
pnpm add resend react-email @react-email/components

# Tickets, dates, ids
pnpm add qrcode nanoid date-fns date-fns-tz
pnpm add -D @types/qrcode

# PDF ticket
pnpm add @react-pdf/renderer

# File upload to R2
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

## 3. Dev dependencies

```bash
pnpm add -D vitest @vitest/coverage-v8 vite-tsconfig-paths
pnpm add -D @playwright/test
pnpm add -D prettier prettier-plugin-tailwindcss
pnpm add -D tsx dotenv-cli
pnpm add -D @types/node
```

## 4. UI components (official CLI)

```bash
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button input label form select textarea \
  card table badge dialog dropdown-menu sonner tabs separator \
  alert skeleton checkbox radio-group popover calendar
```

## 5. Playwright browsers

```bash
pnpm exec playwright install --with-deps chromium
```

## 6. Drizzle init

```bash
pnpm exec drizzle-kit generate   # after schema.ts exists
```

## 7. Local services

```bash
docker compose up -d postgres redis
```

## 8. Verify

```bash
pnpm dev          # http://localhost:3000
pnpm typecheck
pnpm test
```

---

## Directory structure to create

```
echoandaura/
├── README.md                    ← project entry point
├── CHANGELOG.md                 ← what shipped in each tagged release
├── CLAUDE.md                    ← agent instructions (invariants)
├── docs/
│   ├── README.md                ← docs index — start here
│   ├── PHASES.md                ← the build plan
│   ├── WORKFLOW.md              ← how to work with Claude Code
│   ├── PROGRESS.md              ← updated at the end of every session
│   ├── DECISIONS.md             ← ADR log
│   ├── REQUIREMENTS.md          ← signed scope, source of truth
│   ├── ARCHITECTURE.md          ← system diagram, data flow, data model
│   └── RUNBOOK.md               ← ops (written in phase 6)
├── .claude/
│   ├── settings.json            ← permissions + hooks
│   ├── commands/                ← custom slash commands
│   └── agents/                  ← subagents
├── .github/workflows/ci.yml
├── drizzle/                     ← generated migrations, always committed
├── src/
│   ├── app/
│   │   ├── (public)/            ← events, event/[slug], register, ticket/[code]
│   │   ├── (admin)/admin/       ← dashboard, events, orders, verify, reports
│   │   └── api/
│   ├── components/
│   │   ├── ui/                  ← shadcn, do not hand-edit
│   │   └── ...
│   ├── db/
│   │   ├── schema.ts
│   │   └── client.ts
│   ├── server/                  ← NO next/* imports allowed in here
│   │   ├── services/
│   │   ├── repositories/
│   │   └── lib/
│   ├── jobs/
│   ├── emails/                  ← React Email templates
│   └── worker.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
└── scripts/
```

## package.json scripts to add

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "worker": "tsx src/worker.ts",
    "typecheck": "tsc --noEmit",
    "lint": "next lint",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "db:seed": "tsx scripts/seed.ts",
    "verify": "pnpm typecheck && pnpm lint && pnpm test && pnpm build"
  }
}
```

`pnpm verify` is the gate. Nothing merges unless it passes.
