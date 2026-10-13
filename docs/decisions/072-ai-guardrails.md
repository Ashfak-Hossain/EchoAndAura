---
id: ADR-072
title: 'Guardrails for AI-assisted development: Claude reads production, the owner changes it'
date: 2026-10-14
status: accepted
area: Code structure and tooling
supersedes: []
extends: []
---

# ADR-072 — Guardrails for AI-assisted development: Claude reads production, the owner changes it

**Context:** Most of this repository is written with Claude Code, which can
run shell commands, reach the production server over `ssh echoandaura`, and
call GitHub, Cloudflare and AWS with the developer's credentials. The
working rules were already clear: Claude never commits or pushes, the owner
types every change on the server, and tags, releases and merges are the
owner's. But only `git commit`, `git push` and `psql` were actually refused.
Nothing stopped a session from running a TRUNCATE over ssh, tagging a
release, merging a PR, or applying Terraform. On 2026-10-14 the go-live
wipe and the v1.0.0 tag went through that path by hand, as intended, with
nothing technical keeping it that way.

**Decision:** Two layers in [`.claude/`](../../.claude/), both checked by
[claude-hooks.test.ts](../../tests/unit/claude-hooks.test.ts):

- **Permissions** ([settings.json](../../.claude/settings.json)) deny the
  release, merge, settings, deploy and apply commands where they start, and
  allow the read-only `git` and `gh` commands that reviews need.
- **A Bash hook** ([guard-bash.sh](../../.claude/hooks/guard-bash.sh)) is
  the backstop, because permission patterns miss `cd x && …` and
  `ssh host '…'`. It refuses, with a message telling Claude to hand the
  command to the owner:
  - over ssh to production: SQL that writes, `pg_restore` (except
    `--list`), file changes, container/service/volume changes, BullMQ and
    Redis writes, and system changes. Reads, counts, logs, `docker ps`
    and health checks stay allowed;
  - anywhere: creating, moving or deleting tags; pushing tags; changing
    GitHub Releases; merging or closing PRs; repository settings, secrets,
    variables and workflow runs; GitHub API writes; Terraform applies and
    state edits; Ansible applies; Cloudflare deploys; image pushes and
    retags; AWS and S3 writes.

  Global rules match a command where it starts, so a command that only
  mentions one (`grep "gh release create" release.yml`) still runs.

- **The secret check** ([no-secrets.sh](../../.claude/hooks/no-secrets.sh))
  now covers every secret in use: Sentry, Cloudflare, the gate relay,
  Turnstile, Postgres. It still allows published test keys, `<password>`
  placeholders and values that only name another constant.

**Rejected:** relying on the written rules alone (the gap above); a
read-only allowlist for ssh (every new diagnostic would need a hook change,
and a missed read is harmless where a missed write is not); a separate,
read-only SSH key for Claude (the right next step if the hook ever proves
too weak, but another credential to keep and rotate); Claude Code's
sandbox mode alone (it limits the file system and network, not what a
permitted `ssh` or `gh` call does).

**Consequences:** A session can't make a production, release or
infrastructure change by mistake. The owner still types each one, which is
slower, and that is the point. The hook matches text, so a deliberately
disguised command can get past it. It stops mistakes, not attackers. New
outward-facing tools need a rule and a test case. The hooks need `jq`
(already required) and run on macOS and GNU grep alike.

**Revisit when:** Claude gets its own server or cloud credentials (scope
those instead); another developer joins with different rules; or Claude
Code ships a first-party way to declare read-only remote commands.
