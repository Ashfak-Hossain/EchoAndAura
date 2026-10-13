---
description: Close out the session — docs, ADR, commit
---

1. Run `pnpm verify`. If it fails, stop and report; do not commit.
2. Docs: for each line, update the file or say why it does not apply.
   - `docs/ENVIRONMENT.md`: a new or changed environment variable
   - `docs/RUNBOOK.md`: something that can break, or a new step on event night
   - `docs/ARCHITECTURE.md`: a new part, queue, table or data flow
   - `docs/infra/SERVER.md` → History: a change the owner made on the server
     (and `docs/infra/SECRETS.md` for a new secret's name)
   - An ADR, if a non-obvious choice was made: a new file in `docs/decisions/`
     from `TEMPLATE.md`, and its row in that folder's `README.md`
     (README → Adding an ADR)
   - `CHANGELOG.md` → `[Unreleased]`: what changed for the organizer or for
     buyers, in their words. Internal work (tests, tooling, docs) goes in
     none.
3. Prepend a "RESUME HERE" block to `notes/PROGRESS.md`: what was done,
   decisions made, the next slice with its effort line, and any blockers.
   Keep at most two RESUME blocks: move older ones, whole, to the top of
   `notes/archive/PROGRESS-to-<date of the newest block moved>.md` (a new
   file, or the newest one). /prime reads only the first block.
4. Stage the changes and write a conventional commit message
   (`feat(scope): ...`, `fix(scope): ...`, `chore(scope): ...`).
5. Show me the diff summary, then the hand-off as one terminal block: the
   commit heredoc, the push, and `gh pr create` with its title, label and
   body filled in. Do not commit or push.
