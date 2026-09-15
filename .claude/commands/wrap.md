---
description: Close out the session — docs, ADR, commit
---

1. Run `pnpm verify`. If it fails, stop and report; do not commit.
2. Prepend a dated entry to `docs/PROGRESS.md`: what was done, decisions made,
   the next slice, and any blockers.
3. If a non-obvious architectural choice was made this session, add an ADR to
   `docs/DECISIONS.md`.
4. Stage the changes and write a conventional commit message
   (`feat(scope): ...`, `fix(scope): ...`, `chore(scope): ...`).
5. Show me the diff summary and the proposed message. Do not push.
