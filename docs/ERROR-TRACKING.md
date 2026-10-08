# Error tracking

Status: IMPLEMENTED, NOT ACTIVATED · 2026-10-08 · [ADR-068](decisions/068-private-error-tracking.md)

Sentry reports unexpected errors from the browser, Next.js server and BullMQ worker.
It is optional: absent configuration leaves existing application behavior unchanged.
It does not replace health checks, queue retry/audit records, Pino logs or backups.

## What a report contains

Reports retain a generic exception message and a class from a fixed list, sanitized
stack frames, fixed JavaScript/Node protocol metadata, the running image's full Git revision, a static route, component,
operation and queue. Debug IDs connect stack frames to privately uploaded source
maps, so a compiled line can be resolved to application code without sending the
original exception message or request context.

Buyer names, phones, emails, trxIDs, raw URLs, tokens, request bodies/headers/cookies,
SQL parameters, job payloads, breadcrumbs, stack locals and arbitrary metadata are
not forwarded. Replay, tracing, logs, metrics and attachments are disabled or dropped.
Network addresses remain visible to the receiving vendor; configure IP storage
privacy in the project before enabling browser reporting.

## Coverage and limits

- Web: Next's unhandled request errors, existing public/admin/door/global React
  boundaries, unexpected payment-submit and admin order-action failures. Inventory
  mismatch, attendee mismatch and exhausted ticket-code allocation also report.
- Worker: terminal orders/holds/relay failures, queue infrastructure errors,
  startup/shutdown failures and fatal uncaught errors. Expected skips and normal
  retries are not reported; throttling is reported only if its retries are exhausted.
- Other action/service failures that are caught and converted into successful
  responses are not automatically captured. Their existing local logs remain.
- Server: one report per operation/queue/static-route per minute. Browser: at most
  twenty reports per minute, with weak-reference boundary deduplication. Flood
  protection may drop different errors with the same server context.
- Direct browser ingest can be blocked, and offline door scanning never depends
  on reporting. Vendor outages do not change business results or readiness.
- Fatal and graceful worker exits flush for at most two seconds; forced kills
  may lose reports. The existing ten-second shutdown deadline remains authoritative.
  Once required worker/queue/Redis closes succeed, telemetry cannot turn that
  clean shutdown into a failure exit.

## Configuration ownership

| Setting                        | Location                                           | Purpose                                                                                                                  |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SENTRY_DSN`       | GitHub repository variable                         | Public browser DSN, compiled into the image and its CSP. Hosted HTTPS ingest only.                                       |
| `SENTRY_ORG`, `SENTRY_PROJECT` | GitHub repository variables                        | Source-map destination slugs.                                                                                            |
| `SENTRY_BUILD_SOURCEMAPS`      | GitHub repository variable                         | `1` explicitly enables map generation, injection and upload; default `0`.                                                |
| `SENTRY_AUTH_TOKEN`            | GitHub repository secret                           | Restricted build upload credential; supplied only as a BuildKit secret. Never an image ARG/ENV or Dokploy runtime value. |
| `SENTRY_DSN`                   | Dokploy environment                                | Optional server and worker DSN. Invalid/unset values disable reporting.                                                  |
| `NEXT_PUBLIC_SOURCE_REVISION`  | Docker build stage, derived from `SOURCE_REVISION` | Browser release; do not override it at runtime.                                                                          |

Browser reporting requires `NODE_ENV=production`; server and worker reporting
require `APP_ENV=production`. Release metadata stays absent outside a real image
instead of falsely claiming a deployed revision. There is no separate staging
deployment in this repository. Normal local builds and verification never upload.

The worker uses the image's `deployment-revision.json` for release identity. Next
debug IDs are injected in the post-compilation hook before standalone tracing,
and worker IDs are injected after its bundle is built. Encoded local map references
are normalized before injection so bracketed Turbopack chunks resolve correctly.
Generated manifests, empty wrapper maps and Next's legacy no-module polyfill are
not application stack-mapping guarantees; the activation proof checks real errors.
The image build uploads
maps, requires a successful validated upload, waits up to 120 seconds for processing,
then removes maps from output directories that ship. No public maps should exist
in either image. BuildKit may reuse a previously successful build/upload layer;
rotating a credential alone does not invalidate it. To test upload or restore
deleted artifacts, deliberately rebuild that stage without its prior cache.

## Activation gate (owner-run, after merge)

This document records the order, not authorization to change production or create
a paid account. Never paste real DSNs, upload credentials, buyer records or vendor
event payloads into chat or repository notes.

1. Create/select a hosted Sentry project. Confirm its current free-plan quotas,
   email notification support, storage region and source-code access restrictions.
   Do not enable paid overages, replay, tracing, logs or metrics for this slice.
2. Configure server-side data scrubbing as a second layer and disable IP storage.
   Enable production error email notifications to the chosen operator. Check the
   account's current UI rather than assuming a specific alert feature is free.
3. Store the configuration in the locations above. Enable source maps with `1`
   before browser reporting so browser stacks are diagnosable. Runtime changes
   cannot turn on a browser bundle compiled with an empty DSN.
4. Have the owner merge/deploy through the normal [deployment workflow](DEPLOY.md).
   Its image smoke and full web/worker revision confirmation remain required.
5. In a controlled synthetic-only round, capture one browser error, one unhandled
   web error, one caught order-action error and one terminal worker failure. Use no real customer data, no real
   payment, and no failing recurring production job. Do not add a public crash route.
   A temporary authenticated test harness should be reviewed before this round.
6. Confirm the full expected release, component/static route or queue, readable
   mapped stack, no original message/request/user/job values, and an email alert.
   Confirm browser CSP permits only the configured ingest origin and `.map` URLs
   return 404. Record non-secret evidence and only then mark Phase 9.4 complete.

## Rollback and upgrades

Clear `SENTRY_DSN` to disable server/worker reporting at the next restart. Clear
the browser DSN build variable and rebuild to disable browser reporting. Do not
relax CSP or change database state as part of rollback. Privacy concerns require
disabling reporting first; remove vendor-held events through its controls as a
separately approved operation.

For any SDK/CLI upgrade, run the serialized-envelope, SDK pipeline, initialization,
controller, worker and build-contract tests, then `pnpm verify`. Repeat synthetic
mapped-stack and alert proof before claiming the upgraded production integration
is healthy. The SDK's defaults are not this application's privacy policy.
