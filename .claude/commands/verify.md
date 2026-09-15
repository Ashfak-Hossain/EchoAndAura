---
description: Run the full quality gate
---

Run `pnpm verify` (typecheck, lint, test, build).

If anything fails: fix it, then run again. Repeat until green.
Do not report success unless the command actually exited zero.
Do not disable, skip, or weaken a test to make it pass.

Then confirm against the Definition of Done in `docs/DEVELOPMENT.md` and report
which items are satisfied and which are not.
