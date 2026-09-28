## What and why

<!-- One or two sentences: what changes for a buyer, the organizer or the ops side, and why. -->

## Checklist

- [ ] `pnpm verify` is green locally
- [ ] The invariants in CLAUDE.md still hold — money in integer paisa, the
      atomic inventory UPDATE, unique trxIDs, fulfilment only in
      `fulfilment.service.ts`, prices from the server, an `order_events` row
      per state change, no network calls inside a transaction
- [ ] Failure paths are tested, not only the happy path
- [ ] Migrations are generated (never hand-edited) and backward compatible
      for one release (DEPLOY.md → Rolling back)
- [ ] Docs updated (ARCHITECTURE, ENVIRONMENT, infra/, RUNBOOK) and an ADR
      written for any non-obvious choice
- [ ] No secrets, and nothing from `.env`

## Test plan

- [ ] …
