# Documentation index

This is the map. If you're not sure which doc has what you need, start here
instead of guessing from filenames.

## Start here

- **Starting a Claude Code session?** Run `/prime` — it reads `CLAUDE.md`,
  `PHASES.md`, `PROGRESS.md`, and `DECISIONS.md` for you and reports status.
  Don't read them manually first; that's what the command is for.
- **New to the project as a human?** Read in this order:
  [../README.md](../README.md) → [WORKFLOW.md](WORKFLOW.md) →
  [../CLAUDE.md](../CLAUDE.md).

## All docs

| Doc                                | Purpose                                                                                                                                          | Updated by                                                                                         | Updated when                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [../CLAUDE.md](../CLAUDE.md)       | Agent invariants — payment model, money handling, inventory, state machine, architecture rules. The rules that cause financial loss if violated. | Whoever finds a rule being repeated in chat                                                        | A constraint gets violated twice, or a new invariant is discovered     |
| [../SETUP.md](../SETUP.md)         | One-time scaffold commands and the target directory tree                                                                                         | Rarely                                                                                             | Tooling/dependency choices change                                      |
| [../README.md](../README.md)       | Project entry point                                                                                                                              | Rarely                                                                                             | Stack or status headline changes                                       |
| [../CHANGELOG.md](../CHANGELOG.md) | What shipped in each tagged release                                                                                                              | `/wrap`, at tag time                                                                               | Every deploy tag (`v0.3.0-phase3`)                                     |
| [PHASES.md](PHASES.md)             | The phased build plan, exit criteria per phase, risk register                                                                                    | Rarely                                                                                             | Scope or sequencing changes                                            |
| [WORKFLOW.md](WORKFLOW.md)         | The session loop, git discipline, Definition of Done                                                                                             | Rarely                                                                                             | The working process itself changes                                     |
| [PROGRESS.md](PROGRESS.md)         | Session-by-session log — current phase, next slice, blockers                                                                                     | `/wrap`, every session                                                                             | End of every session                                                   |
| [DECISIONS.md](DECISIONS.md)       | ADR log — non-obvious architectural choices, never deleted                                                                                       | `/wrap`, when a call is made                                                                       | A choice is non-obvious or would be questioned later                   |
| [REQUIREMENTS.md](REQUIREMENTS.md) | Scope source of truth                                                                                                                            | Whoever gets client signoff                                                                        | Scope is confirmed or changes — currently a draft template, not signed |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System diagram, data flow, data model overview, deployment topology                                                                              | Rarely                                                                                             | The system shape changes                                               |
| `RUNBOOK.md`                       | Ops procedures — deploy, backup, incident response                                                                                               | _Planned — Phase 6. Does not exist yet; don't write ops docs for infrastructure that isn't built._ | —                                                                      |

`.claude/commands/*.md` and `.claude/agents/*.md` are agent tooling, not
project docs — they're indexed by the harness, not here.

## Doc-header convention

Docs added after this index carry a one-line header under the title:

```
Status: DRAFT | ACTIVE · Owner: <name> · Last updated: YYYY-MM-DD
```

The four pre-existing docs (`PHASES.md`, `WORKFLOW.md`, `PROGRESS.md`,
`DECISIONS.md`) aren't retrofitted with this — they're kept as they are.
