# Documentation

New to the codebase? Read in this order:
[../README.md](../README.md) → [DEVELOPMENT.md](DEVELOPMENT.md) →
[ARCHITECTURE.md](ARCHITECTURE.md) → [../CLAUDE.md](../CLAUDE.md).

| Doc                                                    | Purpose                                                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [../CLAUDE.md](../CLAUDE.md)                           | The invariants — payment model, money, inventory, order state machine, architecture rules. The rules that cause financial loss if violated.        |
| [DEVELOPMENT.md](DEVELOPMENT.md)                       | Setup, environment, scripts, testing, the `pnpm verify` gate, branching, commits, Definition of Done.                                              |
| [ENVIRONMENT.md](ENVIRONMENT.md)                       | Every environment variable — what it's for, whether it's required, and how to obtain it.                                                           |
| [ARCHITECTURE.md](ARCHITECTURE.md)                     | System diagram, data flow, data model overview, deployment topology.                                                                               |
| [DIAGRAMS.md](DIAGRAMS.md)                             | ER, domain class, architecture, order state-machine, and payment sequence diagrams (Mermaid).                                                      |
| [decisions/](decisions/README.md)                      | Architecture decision records (ADRs), one file each, listed by area. Non-obvious choices, never deleted — superseded records are marked.           |
| [REQUIREMENTS.md](REQUIREMENTS.md)                     | Product scope — what is and isn't in the MVP.                                                                                                      |
| [DEPLOY.md](DEPLOY.md)                                 | How code reaches production: CI, images on GHCR, Dokploy, rollback, running a script on the server.                                                |
| [infra/SERVER.md](infra/SERVER.md)                     | The production VPS: how to get in, every change made to it and why, a one-command check, how to rebuild it.                                        |
| [infra/AWS.md](infra/AWS.md)                           | The AWS account: principals, the send-only policy, budgets, SES state, runbooks (rotate key, budget alert). `pnpm infra:check` verifies it.        |
| [infra/CLOUDFLARE.md](infra/CLOUDFLARE.md)             | Domain, the authoritative DNS record table, Email Routing, R2 plan, DMARC runbook.                                                                 |
| [infra/SECRETS.md](infra/SECRETS.md)                   | Every credential: used by, where deployed, blast radius, how to rotate. Names only — values live in Bitwarden.                                     |
| [infra/TERRAFORM.md](infra/TERRAFORM.md)               | The Cloudflare and AWS set-up as code: day-to-day use, plan and apply, adding a resource. Written for someone new to Terraform.                    |
| [infra/DOCS_PUBLICATION.md](infra/DOCS_PUBLICATION.md) | D3A: learn each Terraform hosting change, safe credential boundaries, expected plans, and owner-operated publication gates. Prepared, not applied. |
| [infra/ANSIBLE.md](infra/ANSIBLE.md)                   | The server as code: what is code and what stays by hand, the lab VM, how a change reaches production, rebuilding a server.                         |
| [systems/EMAIL.md](systems/EMAIL.md)                   | How an order becomes an email: hooks → queue → worker → SES; retries, audit rows, the "no email arrived" procedure.                                |
| [systems/LOCALISATION.md](systems/LOCALISATION.md)     | Bangla at `/bn` and 12-hour time: the design, and each slice as it is built.                                                                       |
| [systems/WAITLIST.md](systems/WAITLIST.md)             | Seats that come back go to the next person in line, with 60 minutes to claim (proposed).                                                           |
| [systems/DOCS_SITE.md](systems/DOCS_SITE.md)           | Public developer docs: reading paths, colorful diagrams, selected interactions, static Fumadocs architecture, and delivery slices.                 |
| [../CHANGELOG.md](../CHANGELOG.md)                     | What shipped in each tagged release.                                                                                                               |
| [RUNBOOK.md](RUNBOOK.md)                               | When something breaks: where alerts come from, site down, restore from backup, leaked secret, email, disk, the event-night checklist.              |
| [LOAD-TEST.md](LOAD-TEST.md)                           | How much traffic production takes (measured 2026-09-30), the on-sale rush with no oversell, and how to run the test again.                         |

## Doc-header convention

Docs carry a one-line header under the title:

```
Status: DRAFT | ACTIVE · Owner: <name> · Last updated: YYYY-MM-DD
```
