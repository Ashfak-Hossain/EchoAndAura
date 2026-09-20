# Documentation

New to the codebase? Read in this order:
[../README.md](../README.md) → [DEVELOPMENT.md](DEVELOPMENT.md) →
[ARCHITECTURE.md](ARCHITECTURE.md) → [../CLAUDE.md](../CLAUDE.md).

| Doc                                        | Purpose                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [../CLAUDE.md](../CLAUDE.md)               | The invariants — payment model, money, inventory, order state machine, architecture rules. The rules that cause financial loss if violated. |
| [DEVELOPMENT.md](DEVELOPMENT.md)           | Setup, environment, scripts, testing, the `pnpm verify` gate, branching, commits, Definition of Done.                                       |
| [ENVIRONMENT.md](ENVIRONMENT.md)           | Every environment variable — what it's for, whether it's required, and how to obtain it.                                                    |
| [ARCHITECTURE.md](ARCHITECTURE.md)         | System diagram, data flow, data model overview, deployment topology.                                                                        |
| [DIAGRAMS.md](DIAGRAMS.md)                 | ER, domain class, architecture, order state-machine, and payment sequence diagrams (Mermaid).                                               |
| [DECISIONS.md](DECISIONS.md)               | Architecture decision records (ADRs). Non-obvious choices, never deleted — superseded entries are marked.                                   |
| [REQUIREMENTS.md](REQUIREMENTS.md)         | Product scope — what is and isn't in the MVP.                                                                                               |
| [infra/AWS.md](infra/AWS.md)               | The AWS account: principals, the send-only policy, budgets, SES state, runbooks (rotate key, budget alert). `pnpm infra:check` verifies it. |
| [infra/CLOUDFLARE.md](infra/CLOUDFLARE.md) | Domain, the authoritative DNS record table, Email Routing, R2 plan, DMARC runbook.                                                          |
| [infra/SECRETS.md](infra/SECRETS.md)       | Every credential: used by, where deployed, blast radius, how to rotate. Names only — values live in Bitwarden.                              |
| [systems/EMAIL.md](systems/EMAIL.md)       | How an order becomes an email: hooks → queue → worker → SES; retries, audit rows, the "no email arrived" procedure.                         |
| [../CHANGELOG.md](../CHANGELOG.md)         | What shipped in each tagged release.                                                                                                        |
| `RUNBOOK.md`                               | Ops — deploy, backup, incident response. _Planned; written once there is infrastructure to document._                                       |

## Doc-header convention

Docs carry a one-line header under the title:

```
Status: DRAFT | ACTIVE · Owner: <name> · Last updated: YYYY-MM-DD
```
