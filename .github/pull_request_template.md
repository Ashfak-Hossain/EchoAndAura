<!--
Title: what this does, in the imperative, ≤ 72 characters.
  "Hold inventory for 20 minutes", not "Inventory changes" or "Fixed stuff".
Label: one of feature · fix · security · infra · ci · documentation ·
  dependencies (release notes are grouped by label; .github/release.yml).
Size: aim for one reviewable idea. Over ~400 changed lines? Say why, or split it.
Delete any section below that doesn't apply. Comments like this one don't render.
-->

## Why

<!-- The problem, in one to three sentences, for someone with no context.
What breaks or is missing without this change? Link what led here. -->

Context: <!-- ADR-0xx · Phase x.y · #issue · Sentry/log link -->

## What changes

<!-- The behaviour after merging, for a buyer, the organizer or ops; not a
file list (the diff shows that). Call out anything surprising: a changed
default, a new dependency, a removed feature. -->

-

## How to review

<!-- Save the reviewer's time: where to start, what deserves scrutiny,
what is mechanical (renames, generated code, snapshots). -->

- Start with:
- Look hard at:
- Skim:

## Risk and rollout

<!-- Every merge to main deploys (ADR-036). What could go wrong in
production, and how would we notice and undo it? -->

**Risk:** low / medium / high, because …

- [ ] **Before merging:** new env vars are already in Dokploy → Environment
      (otherwise the deploy fails: DEPLOY.md), or there are none
- [ ] **Migrations** are generated with drizzle-kit (never hand-edited) and
      safe for the previous release to run against (DEPLOY.md → Rolling back),
      or there are none
- [ ] **Behind a flag** (e.g. `PUBLIC_LOCALES`), or live on merge
- [ ] **Infra:** `pnpm tf:<aws|cloudflare> plan` summary pasted below and
      reviewed; after merge, `apply`, then `plan` = No changes

**Rollback:** <!-- Usually: `IMAGE_TAG=sha-<previous>` in Dokploy
(DEPLOY.md → Rolling back). Say if it is not that simple: data written in
a new shape, emails already sent, Terraform apply to revert. -->

## Testing

<!-- What you ran and what it proved. Commands and numbers, not
"tested locally". Name the failure paths you covered. -->

- [ ] `pnpm verify` green (N tests)
- [ ] Integration (`pnpm test:integration:db`) if it touches money,
      inventory, orders, fulfilment or the door
- [ ] E2E for the flows it changes:
- Manual:

<!-- UI changes: before / after screenshots at 360 px and desktop, in
English and Bangla (/bn). Drag images in here. -->

## Checklist

- [ ] **The invariants in CLAUDE.md hold.** Money in integer paisa; the
      atomic inventory UPDATE; unique, normalised trxIDs; fulfilment only in
      `fulfilment.service.ts`; prices from the server; an `order_events` row
      per state change; no network calls inside a transaction
- [ ] Failure paths are tested, not only the happy path
- [ ] Business logic stays in `src/server/` (no `next/*` there); handlers
      and actions stay thin
- [ ] User-facing text is in `src/messages/en.ts` **and** `bn.ts`
- [ ] Docs match the code (ARCHITECTURE, ENVIRONMENT, infra/, RUNBOOK),
      with an ADR for any non-obvious choice
- [ ] No secrets, personal data or `.env` values in the code, the
      screenshots or this description

## Follow-ups

<!-- Deliberately left out of this PR, with an issue or Phase link, so a
reviewer doesn't ask. Delete if none. -->
