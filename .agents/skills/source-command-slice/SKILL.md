---
name: 'source-command-slice'
description: 'Plan an Echo & Aura vertical slice without implementing it'
---

# source-command-slice

Use this skill when the user asks to run the migrated source command `slice`,
plan a vertical slice, or plan the next implementation slice.

## Command Template

Read `AGENTS.md` and `CLAUDE.md`, then plan a vertical slice for the requested
work. Do not write code yet.

Cover, in this order:

1. **Schema** — tables or columns touched, and whether a generated migration is
   needed
2. **Repository** — data-access functions
3. **Service** — business logic in `src/server/`, including applicable
   invariants
4. **Route/action** — the thin controller
5. **UI** — components, loading and empty states, and mobile layout
6. **Tests** — failure paths as well as the happy path

Then state:

- Which of the seven invariants in `CLAUDE.md` the slice touches
- Any risk of breaking existing behaviour
- Files that will be created and files that will be modified

Wait for explicit approval before writing anything.
