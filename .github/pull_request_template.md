<!--
Title: what this does, in the imperative, ≤ 72 characters. It must make
sense alone in `git log`: "Hold inventory for 20 minutes", not "Fixes".
Label: one of feature · fix · security · infra · ci · documentation ·
dependencies (release notes are grouped by label; .github/release.yml).
Keep it to one reviewable idea. Comments like this one don't render.
-->

## Summary

<!-- What changes and WHY, for a reader with no context, in a few short
paragraphs. Start with the problem, then the approach. Call out anything
surprising: a changed default, a new dependency, a removed feature.
Link what led here: ADR-0xx, Phase x.y, #issue. -->

## Test plan

<!-- What you ran and what it proved, so a reviewer could repeat it.
Commands and results, not "tested locally". Name the failure paths covered.
`pnpm verify` (N tests) at minimum. UI: screenshots at 360 px and desktop,
in English and Bangla (/bn). -->

<!--
Add these sections only when they apply; delete this comment otherwise.

## Risk and rollback
Every merge to main deploys (ADR-036). Only needed if it's more than
"low, revert the PR": env vars that must be in Dokploy before merge,
migrations (drizzle-kit generated, safe for the previous release),
a Terraform plan to paste, data written in a new shape, emails sent.

## Invariants
Touches money, inventory, orders, fulfilment or the door? Say how the
CLAUDE.md invariants still hold (integer paisa, the atomic inventory
UPDATE, unique trxIDs, fulfilment only in fulfilment.service.ts, server
prices, an order_events row per state change, no network calls inside a
transaction) and that `pnpm test:integration:db` passed.
-->
