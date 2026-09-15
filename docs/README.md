# Documentation

New to the codebase? Read in this order:
[../README.md](../README.md) → [DEVELOPMENT.md](DEVELOPMENT.md) →
[ARCHITECTURE.md](ARCHITECTURE.md) → [../CLAUDE.md](../CLAUDE.md).

| Doc                                | Purpose                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [../CLAUDE.md](../CLAUDE.md)       | The invariants — payment model, money, inventory, order state machine, architecture rules. The rules that cause financial loss if violated. |
| [DEVELOPMENT.md](DEVELOPMENT.md)   | Setup, environment, scripts, testing, the `pnpm verify` gate, branching, commits, Definition of Done.          |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System diagram, data flow, data model overview, deployment topology.                                           |
| [DECISIONS.md](DECISIONS.md)       | Architecture decision records (ADRs). Non-obvious choices, never deleted — superseded entries are marked.       |
| [REQUIREMENTS.md](REQUIREMENTS.md) | Product scope — what is and isn't in the MVP.                                                                    |
| [../CHANGELOG.md](../CHANGELOG.md) | What shipped in each tagged release.                                                                            |
| `RUNBOOK.md`                       | Ops — deploy, backup, incident response. _Planned; written once there is infrastructure to document._           |

## Doc-header convention

Docs carry a one-line header under the title:

```
Status: DRAFT | ACTIVE · Owner: <name> · Last updated: YYYY-MM-DD
```
