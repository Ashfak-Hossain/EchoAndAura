# echoandaura

[![CI](https://github.com/Ashfak-Hossain/EchoAndAura/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Ashfak-Hossain/EchoAndAura/actions/workflows/ci.yml)
[![Deploy](https://github.com/Ashfak-Hossain/EchoAndAura/actions/workflows/deploy.yml/badge.svg)](https://github.com/Ashfak-Hossain/EchoAndAura/actions/workflows/deploy.yml)
[![Uptime](https://uptime.betterstack.com/status-badges/v1/monitor/2yysn.svg)](https://uptime.betterstack.com/?utm_source=status_badge)
[![License: proprietary](https://img.shields.io/badge/license-proprietary-lightgrey.svg)](LICENSE)

Ticketing for **Echo & Aura**, a live-events organizer in Dhaka:
**[echoandaura.com](https://echoandaura.com)**.

Buyers pick an event, register, and pay by **bKash transfer**. The
organizer checks each transaction ID against the bKash statement, and
approving it sends the tickets by email automatically. At the door, the
tickets' QR codes are scanned with a phone, including when the phone has
no signal.

There is no bKash API: payment is verified by a person. The rules that
protect the money and the seats (integer paisa, an atomic inventory
update, unique transaction IDs, one fulfilment path, an append-only audit
trail) are in [CLAUDE.md](CLAUDE.md).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Node 26 ·
Postgres 17 + Drizzle · Redis 7 + BullMQ (a separate worker process) ·
better-auth · Amazon SES + React Email · Cloudflare R2 · Tailwind 4 +
shadcn/ui · Vitest + Playwright.

Production is one VPS running Dokploy behind Cloudflare. CI builds the
images, and every merge to `main` deploys
([docs/DEPLOY.md](docs/DEPLOY.md)).

## Run it locally

Needs Node 26, pnpm 11 and Docker. The full guide is
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

```bash
pnpm install
cp .env.example .env            # then fill in values (docs/ENVIRONMENT.md)
docker compose up -d            # Postgres, Redis and MinIO (local R2)
pnpm db:migrate
pnpm admin:create               # your admin login
pnpm db:seed                    # five demo events and ~155 orders
pnpm dev                        # http://localhost:3000
pnpm worker                     # second terminal: emails and hold expiry
```

`pnpm verify` (typecheck, lint, unit tests, build) must pass before
anything merges. CI runs it, with the integration tests against a real
Postgres and Redis.

## Documentation

| Read                                         | For                                                  |
| -------------------------------------------- | ---------------------------------------------------- |
| [docs/README.md](docs/README.md)             | the index of every document                          |
| [CLAUDE.md](CLAUDE.md)                       | the payment model and the invariants                 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | how the system fits together                         |
| [docs/DECISIONS.md](docs/DECISIONS.md)       | why it is built this way (ADRs)                      |
| [docs/RUNBOOK.md](docs/RUNBOOK.md)           | what to do when something breaks, and on event night |
| [CHANGELOG.md](CHANGELOG.md)                 | what each release changed                            |

## Security

Please report vulnerabilities privately. [SECURITY.md](SECURITY.md) says
how.

## License

Proprietary. All rights reserved ([LICENSE](LICENSE)). The code is public
to read, not to reuse.
