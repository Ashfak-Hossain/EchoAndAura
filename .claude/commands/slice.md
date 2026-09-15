---
description: Plan a vertical slice before implementing
argument-hint: [what to build]
---

Plan a vertical slice for: $ARGUMENTS

Do not write code yet. Produce a plan covering, in this order:

1. **Schema** — tables/columns touched, migration needed?
2. **Repository** — data access functions
3. **Service** — business logic in `src/server/`, and which invariants apply
4. **Route/action** — the thin controller
5. **UI** — components, loading and empty states, mobile layout
6. **Tests** — including the failure paths, not just the happy path

Then state:

- Which of the seven invariants in CLAUDE.md this slice touches
- Any risk of breaking existing behaviour
- Files that will be created vs modified

Wait for approval before writing anything.
