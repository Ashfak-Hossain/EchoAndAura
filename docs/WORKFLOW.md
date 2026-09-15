# Production Workflow for Claude Code

The system that keeps a codebase coherent when most of it is written by an
agent. Follow it literally — the discipline is the point.

---

## The session loop

Every working session follows the same five steps.

### 1. Orient

```
/prime
```

Loads CLAUDE.md, docs/PHASES.md, docs/PROGRESS.md and reports where things
stand. Never start a session by immediately asking for code.

### 2. Plan before writing

Press **Shift+Tab twice** to enter plan mode, then describe the slice.

Claude explores and proposes; it does not edit. Read the plan properly. This is
the highest-leverage 90 seconds in the session — a wrong plan caught here costs
nothing, and caught after implementation costs an hour.

Reject plans that touch more than one vertical slice.

### 3. Implement one slice

A slice is: schema → repository → service → route/action → UI → test.
Complete and green before the next one starts.

If Claude starts drifting into adjacent files, stop it. Scope creep in an agent
session compounds fast.

### 4. Verify

```
/verify
```

Runs typecheck, lint, tests, and build. **A task is not done until this passes.**
Never accept "should work" — run it.

### 5. Close out

```
/wrap
```

Updates docs/PROGRESS.md, records any ADR, and writes the commit.

---

## Git discipline

```
main         <- always deployable, protected
  |- phase/2-events
  |- phase/3-registration
```

- One branch per phase, PR into main, CI must be green
- Conventional commits: `feat(events): add ticket type editor`
- Commit at every green slice, not at end of day. Small commits are how you
  bisect a bug later.
- Tag every deploy: `v0.3.0-phase3`, and add what shipped to `CHANGELOG.md`
  under that tag

## Context management

The main cause of bad agent output is a bloated context window.

- `/clear` between unrelated tasks — do not carry three features of history
- `/compact` mid-task when context is heavy but continuity matters
- Delegate exploration to subagents so search noise never enters the main window
- Keep CLAUDE.md under ~200 lines. It is loaded every single turn; bloat there
  degrades every response.

## Review gate

Nothing merges without the `code-reviewer` subagent passing. It checks the seven
invariants specifically — an agent-written codebase drifts on exactly those
points because the "simpler" version always looks more idiomatic.

Pay particular attention any time Claude touches:

- `inventory.service.ts` — the atomic UPDATE gets "simplified" into a race
- `money.ts` — paisa gets converted to float
- `fulfilment.service.ts` — logic gets duplicated into a route handler

## Definition of Done

A slice is done when all of these are true:

- [ ] `pnpm verify` passes
- [ ] Tests cover the failure path, not only the happy path
- [ ] No `any`, no `@ts-ignore`, no skipped tests
- [ ] Zod validation on every external input
- [ ] Errors handled and logged with pino, with the order number in context
- [ ] Loading and empty states exist in the UI
- [ ] Works on a 360px-wide screen
- [ ] `code-reviewer` passed
- [ ] docs/PROGRESS.md updated

## When Claude gets something wrong

Do not argue with it across five turns — that pollutes context and rarely
converges. Instead:

1. `/clear`
2. Restate the task with the specific constraint that was violated
3. If it recurs, the constraint is missing from CLAUDE.md — add it there

A rule that has to be repeated in chat is a rule that belongs in the file.

## Weekly

- `pnpm outdated` — review, don't blind-upgrade
- `pnpm audit`
- Prune Docker images on the VPS (25 GB disk)
- Confirm backups ran and `pgbackrest check` passes
- Re-read docs/PROGRESS.md against docs/PHASES.md — are you actually on track?
