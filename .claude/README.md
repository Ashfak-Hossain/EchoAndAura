# The Claude Code workspace

Most of this repository is written with [Claude Code](https://claude.com/claude-code).
This folder is how it works here: what a session may do on its own, what it
must hand to the owner, and the commands, reviewers and hooks that keep both
true. The project's rules are in [CLAUDE.md](../CLAUDE.md); the reasons for
the guardrails are in [ADR-072](../docs/decisions/072-ai-guardrails.md).

## May and never

| Claude may                                                  | Claude never (the owner does it)                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Edit code, run tests, builds and `pnpm verify`              | Commit, push, tag, merge, or publish a release                              |
| Read production over `ssh echoandaura`: counts, logs, state | Change production: SQL writes, files, containers, queues, services          |
| `terraform plan`, `pnpm ansible check`, read-only `aws`     | Apply Terraform or Ansible, deploy to Cloudflare, push images, write to AWS |
| Read GitHub: PRs, runs, releases                            | Change repo settings, secrets, variables, or start workflows                |
| Prepare commit messages, PR bodies and the owner's commands | Write a secret into a file (`no-secrets.sh`), read `.env`                   |

The right-hand column is enforced twice: [settings.json](settings.json) denies
those commands where they start, and [hooks/guard-bash.sh](hooks/guard-bash.sh)
refuses them even inside `cd x && …` or `ssh echoandaura '…'`, with a message
to hand the command to the owner instead.
[claude-hooks.test.ts](../tests/unit/claude-hooks.test.ts) proves each rule
both ways.

## Map

```text
.claude/
├── settings.json           permissions, hooks, status line
├── statusline.sh           branch · version · changed files · context size
├── hooks/
│   ├── guard-bash.sh       before every shell command: refuses the never column
│   ├── no-secrets.sh       before every write: refuses anything that looks like a secret
│   ├── format.sh           after every write: Prettier on that file
│   ├── session-size.sh     on every prompt: past 150k tokens, close the session
│   └── context-tokens.sh   the context size, read from the session transcript
├── commands/               the slash commands below
├── agents/                 the reviewers below
└── scripts/
    └── check-images.sh     a commit's images, and a version's, in GHCR
```

## Commands

| Command               | What it does                                                                    |
| --------------------- | ------------------------------------------------------------------------------- |
| `/prime`              | Loads the current plan and where the last session stopped; asks what to work on |
| `/slice <what>`       | Plans a vertical slice (schema → repository → service → route → UI → test)      |
| `/verify`             | Runs `pnpm verify` until it is green, then checks the Definition of Done        |
| `/wrap`               | Docs checklist, the RESUME block, the commit and PR hand-off                    |
| `/release-status`     | Merged PRs since the last tag, CHANGELOG gaps, the next version, the tag checks |
| `/release <x.y.z>`    | Prepares the release PR (CHANGELOG section, `package.json`); the owner tags     |
| `/prod-check`         | Read-only production report: health, revision, server, queues, settings, TLS    |
| `/event-ready <slug>` | The RUNBOOK's event-night checklist for one event, with live read-only checks   |

## Reviewers

Each reviewer only reads, compares the branch with `origin/main` (including
uncommitted work, since the owner commits), and ends with **APPROVED** or
**CHANGES REQUIRED**, its findings grouped as BLOCKER / SHOULD FIX / CONSIDER.
Run one only when its paths change: each run starts from nothing and costs a
full read of the diff.

| Agent                    | Run it when the change touches                                                          |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `code-reviewer`          | `src/`, `tests/`, `scripts/`; always for money, inventory, orders, fulfilment           |
| `security-reviewer`      | auth, access, rate limits, input, headers, `.github/`, Dockerfile, `ops/`, dependencies |
| `migration-reviewer`     | `src/db/schema.ts`, `drizzle/`, `ops/db/`                                               |
| `public-safety-reviewer` | any committed Markdown, `docs-site/`, fixtures, seed data, emails, public pages         |
| `release-manager`        | not a diff reviewer: `/release-status` and `/release` call it                           |

## Sessions

Every prompt re-sends the whole conversation, so a long session costs more
per turn and recalls its start less well. The status line shows the context
size: **wrap up soon** at 120k, **new session now** at 180k. Past 150k,
`session-size.sh` tells Claude to finish the step in progress, update the
RESUME block in `notes/PROGRESS.md`, and ask for `/clear` then `/prime`.
Claude also suggests a fresh session at natural breaks, such as after
handing off a PR.

## Adding to it

- **A reviewer**: a file in `agents/` with `name`, `description` (say when to
  run it) and `tools` limited to `Read, Grep, Glob, Bash`. Add its row above.
- **A command**: a file in `commands/` with a `description`. Add its row above.
- **A hook or script**: executable, with a test case in
  [claude-hooks.test.ts](../tests/unit/claude-hooks.test.ts) or
  [claude-workspace.test.ts](../tests/unit/claude-workspace.test.ts).
- **A new outward-facing tool** (a CLI that can change something remote): a
  refusal rule in `guard-bash.sh`, a `deny` entry in `settings.json`, and a
  test that the rule refuses it.

`claude-workspace.test.ts` fails when this page and the folder disagree.

## Codex

`.codex/` and `.agents/` hold an older mirror for OpenAI Codex (the secret
check, formatting, a code reviewer and the first four commands). It is
secondary: Claude Code is the primary tool, and the mirror does not carry the
guardrails, the reviewers added later or the session meter.
