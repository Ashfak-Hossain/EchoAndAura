---
description: Load project context and report current status
---

Read these files in order, then report status. Do not write any code.

1. `CLAUDE.md` — the invariants
2. `notes/PHASES.md` — the plan
3. `notes/PROGRESS.md` — where we left off
4. `docs/DECISIONS.md` — past architectural choices
5. `git log --oneline -10` and `git status`

Then output exactly:

- **Current phase** and what it requires
- **Last completed slice**
- **Next slice** to build
- **Blockers**
- Anything in the working tree that looks unfinished or uncommitted

Ask what to work on. Do not start until told.
