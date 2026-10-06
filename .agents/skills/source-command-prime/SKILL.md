---
name: 'source-command-prime'
description: 'Load project context and report current status'
---

# source-command-prime

Use this skill when the user asks to run the migrated source command `prime`.

## Command Template

Read these files in order, then report status. Do not write any code.

1. `AGENTS.md` — repository-level agent instructions
2. `CLAUDE.md` — the money, inventory, order and fulfilment invariants
3. `notes/PHASES.md` — the plan
4. `notes/PROGRESS.md` — where we left off
5. `docs/decisions/README.md` — past architectural choices, by area; then the
   three newest ADRs in that folder, in full
6. `git log --oneline -10` and `git status`

Treat Git and the decision index as the current source of truth when a local
progress note is stale. Call out the mismatch instead of repeating old status.

Then output exactly:

- **Current phase** and what it requires
- **Last completed slice**
- **Next slice** to build
- **Blockers**
- Anything in the working tree that looks unfinished or uncommitted

Ask what to work on. Do not start until told.
