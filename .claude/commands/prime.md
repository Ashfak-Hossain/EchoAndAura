---
description: Load project context and report current status
---

Load only what the next step needs. Every turn re-sends the whole context, so
what /prime reads is paid for again on every prompt of the session. Do not
write any code.

1. `CLAUDE.md` is already in context. Do not read it again.
2. Where we left off: the header and the first "RESUME HERE" block of
   `notes/PROGRESS.md`, and nothing after it:
   `awk '/^### /{n++} n<2' notes/PROGRESS.md`
3. The plan: the headings of `notes/PHASES.md` (`grep -n '^## ' notes/PHASES.md`),
   then only the section the RESUME block names as current, by line range
   (`sed -n 'START,ENDp'`).
4. Past choices: one line per ADR (`grep '^| [0-9]' docs/decisions/README.md`),
   then the three newest ADRs in `docs/decisions/` in full.
5. `git log --oneline -10`, `git status`, and `gh pr list --state open`.

Read anything else only when a step needs it. Older history is in
`notes/archive/`.

Then output exactly:

- **Current phase** and what it requires
- **Last completed slice**
- **Next slice** to build
- **Blockers**
- Anything in the working tree that looks unfinished or uncommitted

Ask what to work on. Do not start until told.
