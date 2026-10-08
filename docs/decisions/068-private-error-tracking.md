---
id: ADR-068
title: Error-only Sentry reporting with an outbound privacy allowlist
date: 2026-10-08
status: accepted
area: Infrastructure and deploys
supersedes: []
extends: []
---

# ADR-068 — Error-only Sentry reporting with an outbound privacy allowlist

**Context:** Health checks prove that processes answer, not why a page or job
failed. The application handles payments manually and carries buyer contacts,
transaction IDs, magic links and gate credentials. Sending arbitrary exception
messages, SQL errors, request context or queue payloads to a third party is not
acceptable. Sentry's data-collection defaults can change between SDK releases.

**Decision:** Use exactly pinned Sentry SDKs for errors only. Next's own
instrumentation hook captures unhandled web failures; existing React boundaries
capture client failures. Payment and admin-order controllers report unexpected
failures only after the service has returned or its transaction has unwound.
Completed-job listeners report terminal worker failures, not every retry.
No Pino forwarding, database instrumentation or service-transaction reporting.

The [outbound policy](../../src/lib/error-tracking/privacy.ts) rebuilds an event
from allowed fields: exception class, generic message, generated debug IDs and
stack line/column positions, image-owned release, static route, component,
operation and queue. Raw messages, function names, source context, filenames,
locals, user/request data, breadcrumbs, SQL, job data and arbitrary tags are
dropped. A second check at the transport boundary also drops attachments and
all non-error envelopes. Tracing, replay, logs, metrics and propagation are not
enabled. SDK collection categories are explicitly disabled rather than relying
on defaults. See [Sentry data controls](https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/).

The [server adapter](../../src/server/lib/error-tracking.ts) is independent of
Next.js. Missing/invalid configuration leaves reporting off. Telemetry failures
must not change checkout, inventory, health, retries or exit codes. Flushes have
a two-second hard bound, inside the worker's existing ten-second shutdown bound.
Server reporting permits one event per operation/queue/static-route per minute;
initialization, deduplication and this budget are process-shared because Next
compiles instrumentation and server actions into separate module graphs.
browser reporting permits twenty events per minute and suppresses duplicate
boundary captures. Expected conflicts and Next navigation control flow are not
reported. A terminal throttling failure is reported once retries are exhausted.

Browser configuration is image-build-owned; CSP adds only the validated hosted
HTTPS ingest origin. Server and worker release identity comes from the existing
image manifest, never a runtime override or mutable `main` label.

The [artifact build](../../scripts/error-tracking-build.mjs) injects debug IDs
before Next traces the standalone server. An explicitly opted-in image build
normalizes encoded local map references before injection; otherwise CLI 3.8 misses
Turbopack maps whose filenames contain brackets or parentheses. The build
uploads web and worker maps with an ephemeral BuildKit credential, validates
them and waits for processing. Upload failure fails the image build. Maps are
removed from shipped static/server directories and the worker after upload.
Normal local builds and `pnpm verify` never upload. See [Docker secret mounts](https://docs.docker.com/reference/dockerfile/#run---mounttypesecret).

**Rejected:** Regex-only redaction cannot identify every name or transaction ID.
Generic logger forwarding can include SQL/PII and can send during a transaction.
Default SDK instrumentation, session replay and request recording collect more
than this slice needs. A browser tunnel adds server work and an ingestion endpoint;
direct ingest can be blocked by browsers or ad blockers, which is an accepted limit.

**Consequences:** Diagnosis relies on private source maps and stacks, not original
messages or user identity. Rate limits can intentionally drop distinct errors during
an outage. Source maps disclose application source to the selected Sentry project;
keep its access restricted. Direct browser transport exposes the network address
to the vendor even though user fields are removed; enable the project's IP-storage
privacy setting before activation. Reporting cannot guarantee delivery during an
outage or after a forced process kill. Production activation is a separate
owner-run step: project privacy settings, error email notifications, configuration,
deployment, and synthetic browser/web/worker proof. See [ERROR-TRACKING.md](../ERROR-TRACKING.md).

**Revisit when:** Useful stacks cannot be recovered without private runtime data,
another region/vendor is required, error quotas are exceeded, or an SDK upgrade
changes its event/envelope or source-map behavior. Expand collection only through
a new reviewed privacy decision and serialized-envelope tests.
