# Architecture Decision Records

Short entries. Written when a choice is non-obvious or would be questioned
later. Never deleted — superseded entries are marked, not removed.

---

## ADR-001 — Manual bKash verification instead of API integration

**Date:** 2026-08-21 · **Status:** Accepted

**Context:** The client does not have a bKash merchant account and cannot obtain
one before the launch date.

**Decision:** Buyers pay manually and submit a transaction ID. An admin verifies
against the bKash statement and approves, which triggers automatic ticket issue.

**Consequences:** No payment API, tokens, callbacks, or reconciliation job.
Introduces manual admin workload (~1 hour/day at 1,000 attendees) and requires a
24-hour inventory hold rather than a 10-minute cart hold. Transaction ID
uniqueness must be enforced at the database level to prevent reuse.

**Revisit when:** a merchant account is obtained — the state machine is designed
so an API path can be added without changing the fulfilment logic.

---

## ADR-002 — 24-hour inventory hold

**Date:** 2026-08-21 · **Status:** Accepted

**Context:** Manual verification may take hours. A 10-minute cart hold would
expire before an admin ever sees the order.

**Decision:** Inventory is held for 24 hours on order submission, released on
rejection or expiry. Orders are capped at 10 tickets to limit the damage a
malicious or abandoned order can do to availability.

**Consequences:** A sold-out event may show unavailable while holds are pending.
Accepted because the alternative — overselling — is worse.

---

## ADR-003 — Adopt latest major versions at scaffold time

**Date:** 2026-09-15 · **Status:** Accepted

**Context:** Phase 0 was scaffolded with the latest available majors rather than
the versions the original `CLAUDE.md § Stack` list assumed. `create-next-app@latest`
and the subsequent installs resolved to newer majors.

**Decision:** Build on the latest _stable_ majors: Next.js 16 (was 15), React 19,
Node 26 (runtime; `.nvmrc`), Tailwind 4, drizzle-orm 0.45 with the **postgres-js**
driver (`postgres`, not `pg`), Vitest 5, Playwright 1.x. Drizzle 1.0 exists only
as a pre-release (rc/beta) and was **not** adopted — the data layer stays on the
stable 0.45 line.

**Consequences / breaking-change handling:**

- `next lint` was removed in Next 16 → the `lint` script calls `eslint` directly.
- Next 16 generates route-aware type helpers (`LayoutProps`/`PageProps`), so
  `typecheck` runs `next typegen && tsc --noEmit` (else a fresh checkout/CI fails
  before `tsc` starts).
- Next 16 auto-manages an agent-rules block via `next dev`; an `AGENTS.md` at the
  repo root hosts it so `CLAUDE.md` is never rewritten.
- vitest 5 pulls vite 8, which declared a dependency on an unpublished
  `lightningcss@^1.33.0`; pinned to `1.32.0` via a pnpm override in
  `pnpm-workspace.yaml`.
- The bleeding-edge stack has React-19 peer mismatches, so
  `strict-peer-dependencies=false` in `.npmrc` (warnings still print).
- The Vitest config is `vitest.config.mts` (ESM) to satisfy vite's native loader.

**Revisit when:** Drizzle 1.0 reaches stable GA (evaluate upgrade); or when peer
warnings clear as the ecosystem catches up to React 19 — then re-enable
`strict-peer-dependencies`.

---

## ADR-004 — Auth instance lives outside `src/server/`

**Date:** 2026-09-15 · **Status:** Accepted

**Context:** better-auth's `nextCookies()` plugin — required so server actions can
set the session cookie — transitively imports `next/headers`. `src/server/` must
stay free of `next/*` so the BullMQ worker can import business logic directly.

**Decision:** The auth instance is `src/lib/auth.ts`. A Next-free options builder,
`src/lib/auth-options.ts`, is shared with `scripts/create-admin.ts`. Business
logic in `src/server/` never imports auth; it receives the acting admin as a
parameter. There is exactly one admin: public sign-up is disabled and the account
is seeded once through the public `signUpEmail` API.

**Consequences:** Auth is an app-layer concern; services stay runtime-agnostic and
testable without a request scope. Auth tables are plural (`usePlural: true`) to
avoid the Postgres reserved word `user`. Guarding is two-layer: `src/proxy.ts`
(Next 16 proxy) does an optimistic cookie check; the `(protected)` layout does the
authoritative DB-backed session check.

**Revisit when:** more than one admin or role-based access is needed
(better-auth's `admin` plugin).

---

## ADR-005 — Service/repository shape: factories, a composition root, typed domain errors

**Date:** 2026-09-16 · **Status:** Accepted

**Context:** The first real `src/server/` vertical (event CRUD) sets the
template every later service follows, including `fulfilment.service.ts`. A
service that imports a concrete repository transitively imports
`src/db/client.ts`, which requires `DATABASE_URL` at import time — so unit
tests would need a database just to load the module.

**Decision:**

- A repository module exports an **interface** plus one real implementation
  bound to `db`, and is the only code that touches Drizzle for its table. It
  maps database-enforced constraints to typed errors (e.g. Postgres `23505` on
  `events_slug_unique` → `EventSlugTakenError`) — uniqueness is never checked
  by read-then-write.
- A service is a **factory** (`createEventsService(repo)`) depending only on
  the repository interface. It throws typed domain errors from
  `src/server/lib/errors.ts` (`DomainError` subclasses).
- `src/server/container.ts` is the single **composition root** that wires
  services to real repositories; the app and the worker import instances from
  there.
- **Zod schemas live at the boundary** (`src/lib/validation/`), including
  cross-field rules; the service only ever receives coherent input. Server
  actions catch known domain errors by class and map them to messages;
  anything else is logged and surfaced generically (never disguised as a user
  mistake).
- All admin-facing wall-clock times are `Asia/Dhaka` (`src/lib/time.ts`);
  storage is UTC `timestamptz`.

**Consequences:** Service unit tests use in-memory fakes with no mocking
framework and no database. Adding a service means: repository interface +
impl, factory, one line in the container. Slightly more ceremony than
importing `db` directly — accepted for testability and the worker sharing the
same instances.

**Revisit when:** the number of services makes the container unwieldy
(consider a lightweight DI helper) — not expected within this project's scope.

---

## ADR-006 — Event status: transition table, readiness check, conditional UPDATE

**Date:** 2026-09-18 · **Status:** Accepted

**Context:** Events move between `draft`, `published` and `archived`. A
half-configured event must never go live, an illegal move must be impossible
rather than merely unlikely, and two admin tabs acting at once must not leave
the status inconsistent.

**Decision:**

- The legal moves are a data table (`EVENT_TRANSITIONS` in
  `src/server/lib/event-status.ts`); `assertEventTransition` throws
  `InvalidEventTransitionError` for anything else. The admin UI renders its
  buttons from the same table, so it can never offer a move the service
  rejects. `archived → draft` is allowed so a mistaken archive is recoverable.
- Publishing is gated by a pure readiness function that returns _reasons_
  (`publishReadiness` → `PublishProblem[]`), not a boolean. The page shows the
  list as a checklist; the service refuses with `EventNotPublishableError`
  carrying the same messages. One source of truth for "why can't I publish".
  Checks today: ≥ 1 ticket type, start in the future, valid registration
  window. A cover image becomes a check when R2 upload lands.
- The status write is a conditional atomic UPDATE
  (`… WHERE id = $id AND status = $from RETURNING *`). Zero rows →
  `EventStatusConflictError`; no read-then-write window.

**Consequences:** `createEventsService` now depends on the ticket-types
repository (for the readiness count) and an injectable clock. Events have no
audit log — `updated_at` is the only trace of a status change. Orders keep
`order_events` (Invariant 6); if Raj ever asks "who unpublished this", add an
`event_events` table then, not now.

**Revisit when:** more statuses are needed (e.g. `cancelled` with buyer
notifications), or an event audit trail is requested.

---

## ADR-007 — Cover images: presigned direct uploads, keys not URLs, MinIO locally

**Date:** 2026-09-18 · **Status:** Accepted

**Context:** Events need a cover image (event page, Facebook share preview).
No R2 bucket existed at implementation time. Image bytes must not flow through
the Next.js server, and no network call may sit inside a database transaction
(Invariant 7).

**Decision:**

- **Direct-to-storage upload in three steps.** The server validates the
  browser's claimed type/size and presigns a PUT bound to exactly those
  (`Content-Type` and `Content-Length` are signed). The browser uploads. The
  server then `HEAD`s the object, re-validates what storage actually holds,
  checks the key is one this event could have been issued, and only then
  writes `events.image_key`. The previous object is deleted after the row
  update, best-effort.
- **Store the object key, not a URL.** `events.image_url` was renamed to
  `image_key`. Public URLs are derived at render time from `R2_PUBLIC_URL`,
  so moving buckets or domains never touches rows.
- **One S3 adapter, env-driven.** `src/server/storage/object-storage.ts`
  (`@aws-sdk/client-s3`, path-style addressing). Locally the same code hits
  **MinIO** from `docker-compose.yml`; in production, Cloudflare R2. The
  container constructs it lazily so builds and unit tests need no credentials.
- **"Has a cover image" is a publish readiness check.**

**Consequences:** e2e and the storage integration test run fully offline. R2
needs a CORS rule for the app origin (documented in ENVIRONMENT.md). Images
are stored as uploaded — no resizing; if Open Graph needs an exact 1200×630,
add a worker job (`sharp`) in Phase 2 rather than resizing in the request.

**Revisit when:** multiple images per event, or image processing, is needed.
(Revisited 2026-09-26 by ADR-033: covers are still stored as uploaded, but
they are resized on display by Next's image optimizer.)

---

## ADR-008 — Admin UI: light-only tokens, URL-state editor tabs, honest roadmap nav

**Date:** 2026-09-18 · **Status:** Accepted

**Context:** The approved design (design system + admin canvases) replaced
the throwaway markup used while Phase 1 logic was built. Several choices in
that swap are not visible from the components alone.

**Decision:**

- **Tokens are the design's hex values, light theme only.** The shadcn
  `.dark` block was removed: the brief specifies light for v1, and an untested
  theme is a liability. Extra semantic tokens (`success`, `warning`, `info`,
  their tints, `accent-ink`, `border-strong`, `shadow-*`) sit beside the
  shadcn set. Headings use Archivo (`next/font`), UI text the Helvetica system
  stack, codes Geist Mono; every money/quantity/code cell is `tabular-nums`.
- **The event editor's tabs are URL state** (`?tab=details|cover|ticket-types|publish`),
  server-rendered: deep-linkable, no client tab state, and each tab only
  loads its section. Actions redirect to the tab they belong to.
- **The sidebar shows the whole roadmap** but unbuilt sections render as
  disabled items (`aria-disabled`, "soon"), never as links to 404s.
- **Status vocabulary is one exhaustive map** (`src/lib/status-labels.ts`,
  keyed by the real `pgEnum` values; a unit test fails when a value has no
  chip). Buyer- and admin-facing wording agree.
- **Navigation is always a real link** (`ButtonLink` = `next/link` with
  button styles). shadcn's `Button render={<Link/>}` would give it
  `role="button"`.
- **A committed Prettier config** (`.prettierrc`: single quotes, width 100,
  Tailwind class sorting) codifies the convention the codebase already used;
  `drizzle/` and `src/components/ui/` are ignored because they are generated.

**Consequences:** Ticket-type editing stays on its own pages (the design's
sheet, drag-to-reorder, the unsaved-changes guard, rich-text description and
an upload progress bar are deferred polish). The e2e suite is the safety net
for the swap — labels were kept, only tab clicks were added.

**Revisit when:** a dark theme is requested, or the sheet-based ticket-type
editor is built (then the pages become the fallback route).

---

## ADR-009 — Public event page: phase as a pure function, archived pages stay live, OG from server metadata, e2e on a production build

**Date:** 2026-09-18 · **Status:** Accepted

**Context:** `/events/[slug]` is where Facebook clicks land. It has six visual
states, must carry Open Graph tags the crawler can read, and must keep working
for events that are over. Separately, the e2e suite had become flaky against
`next dev`.

**Decision:**

- **`eventPhase()`** (`src/server/lib/event-phase.ts`) is the single pure
  decision — past → closed → not_open → sold_out → closing_soon → open — and
  the page derives header block, CTA and whether quantities are shown from
  that one value. Boundaries are unit-tested.
- **Archived events keep their public page** (past state, no CTA, cover
  desaturated); drafts and unknown slugs are the same 404. Links already
  shared on Facebook must not die when an event is archived.
- **Metadata is a pure builder** (`src/lib/seo.ts`) rendered by
  `generateMetadata`, so `og:title/description/url/image` (1200×630) and the
  canonical URL are in the server HTML. `SITE_URL` provides the absolute
  origin; `FACEBOOK_PAGE_URL` is optional.
- **Postgres errors are recognised by SQLSTATE shape** (`code` matches
  `^[0-9A-Z]{5}$` and `severity` is present), not `instanceof` (breaks under
  dev HMR — the pooled client outlives the module) and not `err.name`
  (minified to e.g. `"ds"` in the production bundle). Found because the e2e
  suite now runs against a build.
- **E2E runs against a production build** on port 3100, started by
  Playwright. `next dev` stalls server actions under parallel load after HMR
  churn; a built server is deterministic and is what CI runs.

**Consequences:** Public copy avoids QR wording (no scanning at the gate —
superseded by [ADR-030](#adr-030--gate-scanner-slice-a-gate-passes-one-atomic-check-in-a-self-hosted-decoder));
attendance counts wait for Phase 6. E2E costs a ~30 s build per run and
needs no dev server.

**Revisit when:** a waitlist is added (the sold-out state changes), or
events gain a separate "cancelled" status.

---

## ADR-010 — Event description: rich text stored as allowlisted HTML in the same column

**Date:** 2026-09-18 · **Status:** Accepted

**Context:** The organizer wanted formatted descriptions (headings, lists,
links) on the public event page. `events.description` was a plain-text
column with blank-line paragraphs, and some rows already held that shape.

**Decision:**

- **Tiptap** (`@tiptap/react` + StarterKit + Link) is the editor, with a
  toolbar limited to Bold · Italic · H2/H3 · lists · quote · link. The
  editor mirrors its HTML into a controlled hidden input, so a server-action
  round-trip never resets it (React only resets uncontrolled fields).
- **Storage is sanitised HTML in the existing column** — no migration, no
  second column. `src/server/lib/description.ts` is the one module that
  knows the allowlist (`p br strong em s u h2 h3 ul ol li blockquote a`,
  `href` only `http(s)`/`mailto`, links forced `rel="noopener noreferrer"`).
  The service sanitises on **every write**; `RichText` sanitises again on
  render. Defence in depth costs microseconds.
- **Legacy plain text keeps working.** `descriptionToHtml` treats a value
  that does not start with a tag as plain text and wraps its blank-line
  paragraphs, so pre-editor rows render unchanged and load into the editor
  correctly. A write normalises the row to HTML.
- **An empty editor stores NULL**, not `<p></p>`, so "has a description"
  stays a meaningful check.
- Meta descriptions (`og:description`) come from `descriptionToPlainText`.
- One `.rich-text` style block in `globals.css` serves both the editor's
  content area and the public page — what Raj types is what buyers read.

**Consequences:** `dangerouslySetInnerHTML` is used in exactly one component
(`src/components/rich-text.tsx`) and only for content that has been through
the sanitiser. The Zod max for the field is 50 000 characters because HTML
is 3–5× the visible text. Images, tables and embeds are deliberately outside
the allowlist.

**Revisit when:** inline images are requested (needs an upload path and
`img` in the allowlist with a key-prefix check like cover images), or if
descriptions ever need to be rendered somewhere HTML is unwelcome (emails,
PDF) — then add a Markdown/plain-text derivation, not a second source.

---

## ADR-011 — Inventory primitives: three conditional UPDATEs with an injectable executor

**Date:** 2026-09-19 · **Status:** Accepted

**Context:** Invariant 2 says inventory is held with one conditional atomic
UPDATE, never read-then-write. Order creation (Phase 3) must hold inventory
and insert the order in the same transaction; fulfilment (Phase 4) must
convert held → sold and mark the order paid together; rejection and expiry
must release. The concurrency test has imported
`reserveTicketInventory(id, qty)` from the service module since Phase 0.

**Decision:**

- `src/server/repositories/inventory.repository.ts` is the **only** writer
  of `quantity_reserved` / `quantity_sold`. Three methods, each a single
  `UPDATE … WHERE <condition on current values> RETURNING id`: `reserve`
  (available ≥ qty), `release` (held ≥ qty), `convertToSold` (held ≥ qty).
  The database evaluates the condition under the row lock, so no two callers
  can both pass a check only one of them satisfies.
- **Sold-out is a value, corruption is an exception.** `reserve` resolves
  `false` when stock is short — an expected outcome the page must explain.
  `release`/`convertToSold` matching no row means something is already
  wrong (double release, double approve) and throws `InventoryStateError`;
  the `ticket_types_*` CHECK constraints backstop both, and a `23514` is
  mapped to the same error.
- **Every method takes an optional executor** (`DbExecutor` =
  pool | Drizzle transaction, `src/db/executor.ts`). Repositories never open
  transactions; the service that owns the business operation does, and
  passes `tx` down. The integration test proves a reserve inside a
  transaction rolls back with it.
- `createInventoryService(repo)` validates the quantity rule (integer 1–10,
  `src/server/lib/order-rules.ts`, shared with the Zod boundary) and nothing
  else. Sales windows, event status and prices are order-creation concerns.
- The historic `reserveTicketInventory` export is kept so the concurrency
  test never needs editing. It binds to the real repository with a **lazy
  dynamic import**, because the repository imports `db/client`, which needs
  `DATABASE_URL` at import time — a static import would drag that into every
  unit test loading the service.
- The vitest **integration project sets `DATABASE_URL = TEST_DATABASE_URL`**.
  The test seeds rows through its own client on `TEST_DATABASE_URL` while
  the code under test uses the shared `db` on `DATABASE_URL`; before this
  they were two different databases and the row under test was invisible to
  the service. This also guarantees the integration suite never writes to
  the dev database.

**Consequences:** CI now runs `pnpm db:migrate && pnpm test:integration:db`
(the Postgres-only subset) after `pnpm verify`; the storage integration test
stays local-only until MinIO is added to CI. `ticket-types.repository.ts`
continues to never touch the two counters.

**Revisit when:** a waitlist needs "reserve when released" semantics
(a NOTIFY on release, or a queue), or when per-order holds need to be
individually addressable (a `holds` table) rather than a counter.

---

## ADR-012 — Order creation: one transaction, prices from the row, uuid URLs, attendee names on the order

**Date:** 2026-09-19 · **Status:** Accepted

**Context:** The A3 form is where money starts. It must never oversell
(Invariant 2), never trust a client price (5), always leave an audit row
(6), never do network work inside a transaction (7), and must keep a
buyer's input on every error. The order page shows the buyer's email and
phone.

**Decision:**

- **`ordersService.createOrder` reads first, then runs exactly three
  statements in one transaction**: `inventory.hold` → insert `orders`
  (`pending_payment`, `hold_expires_at = now + 24 h`) → insert
  `order_events` (`buyer / order.created / null → pending_payment`). The
  event window (`eventPhase`), ticket-type ownership and sales window
  (`ticketTypeSaleState`) and the price are all read _before_ the
  transaction, so the `ticket_types` row lock lasts microseconds. Sold-out
  is thrown **inside** the callback (`SoldOutError`) so the rollback is
  automatic and nothing is written. `runInTransaction` is injected — the
  service never imports the client, and unit tests fake it with a snapshot
  that restores on throw.
- **Money comes from `ticket_types.price_paisa` via `computeOrderTotals`**
  (`src/server/lib/pricing.ts`), the only place totals are computed. The Zod
  schema strips unknown keys, so a `totalPaisa` in the body is simply gone.
  Discount is 0 until promo codes (Phase 5); the cap-at-subtotal rule is
  already in place.
- **Orders start as `pending_payment`.** The state machine
  (`order-status.ts`, from CLAUDE.md) and the A4 design ("Awaiting payment"
  → "Checking payment") agree; CLAUDE.md's payment-model step 2 was
  reworded to match.
- **Expiry policy.** The expiry job selects
  `status = 'pending_payment' AND hold_expires_at < now()` **only**. A
  `pending_verification` order has a trxID, so real money may have left
  the buyer's account; it is resolved by Approve/Reject, never by the
  clock. `pending_verification → expired` stays legal in the table for an
  admin acting by hand on a stale, never-verified claim.
- **Order page URL is `/orders/<uuid>`, `noindex`, `force-dynamic`.** The
  reference `EA-XXXXXX` (unambiguous alphabet, ~887 M values, UNIQUE + one
  retry loop on collision) is for the bKash reference field and phone
  calls, not for access.
- **Attendee names are a `text[]` column on `orders`** (migration 0003).
  Tickets are created at fulfilment; the names captured on A3 wait on the
  order and are copied onto ticket rows then.
- **Phone is stored E.164** (`+8801XXXXXXXXX`), entered as ten digits after
  a fixed `+880`. The bKash statement shows the sender's number, so this is
  what the admin will compare against.
- `BKASH_RECEIVE_NUMBER` / `ORGANIZER_CONTACT_EMAIL` are env for now;
  Settings (B14) takes them over in Phase 6.

**Consequences:** The integration suite proves a 12-way race for the last
ticket yields one order, and the e2e suite proves it through two browser
contexts. Registration has no promo field yet (design shows one).

**Revisit when:** promo codes land (discount input to `computeOrderTotals`,
promo row read before the tx), or if orders ever need more than one ticket
type (the schema's one-type-per-order rule is load-bearing here).

---

## ADR-013 — Payment submission and the expiry worker

**Date:** 2026-09-19 · **Status:** Accepted

**Context:** Phase 3's exit is "an order holds inventory and expires
correctly". The buyer must be able to report a bKash payment, correct a
mistyped trxID, and never pay for the same order twice with one
transaction; lapsed holds must go back on sale without ever being released
twice.

**Decision:**

- **One status-writing repository method.** `ordersRepository.transition(id,
{ from[], to, patch })` is the conditional
  `UPDATE … WHERE id = $id AND status = ANY($from) RETURNING *`. Null means
  the row moved; callers throw `OrderStatusConflictError` and the page
  re-renders in the real state. Fulfilment, reject and cancel (Phase 4/6)
  reuse it — there is no other way to write `orders.status`.
- **Submission is allowed from `pending_payment` and `pending_verification`.**
  The first moves the status (`payment.submitted`); a later one only
  replaces the trxID/number (`payment.updated`), matching the design's
  "Edit transaction ID". The UNIQUE index on `bkash_trx_id` is the only
  uniqueness check (Invariant 3); it surfaces as `TrxIdAlreadyUsedError`
  and the audit row rolls back with the refused write. Uniqueness is a
  banner on the page, not a field error (design A4).
- **The expiry job is the sole authority on expiry.** It selects
  `status = 'pending_payment' AND hold_expires_at < now()` and, per order in
  one transaction: flip the status conditionally → _only then_ release the
  hold → audit row (`system / order.expired`). A submission racing the job
  is settled by whichever conditional UPDATE lands first; a second run or a
  second worker can never double-release because the flip fails. The A4
  page shows a lapsed hold as expired before the job runs, so nobody is
  invited to pay for tickets about to go back on sale.
- **The worker owns the schedule.** `src/worker.ts` upserts a BullMQ job
  scheduler (`expire-holds`, every 60 s) on boot — idempotent across
  restarts and replicas — and processes it with a one-line call into the
  tested service. The Next app does not connect to Redis in Phase 3.
  `pnpm jobs:expire-holds` runs the same service once for ops.
- **pino** (`src/server/lib/logger.ts`) is the logger for services and the
  worker; pretty locally, JSON in production. Order ids are logged, never
  trxIDs or buyer contact details.

- **Defence in depth on the trxID:** the service upper-cases and trims
  whatever it is given, and migration `0004` adds
  `CHECK (bkash_trx_id = upper(btrim(bkash_trx_id)))`, so no code path can
  store a value the UNIQUE index would not compare correctly. The audit
  row's from-status is read under `SELECT … FOR UPDATE` so two tabs
  submitting at once cannot make it lie.
- **A failing order never blocks expiry:** each lapsed hold runs in its own
  transaction inside a try/catch; failures are logged, counted, and fail
  the BullMQ job, while the rest of the batch still expires.

**Consequences:** A `pending_verification` order never expires
automatically; if the organizer never acts, it holds inventory until they
Approve or Reject (B7/B8, Phase 4). The "Checking payment" page refreshes
itself every 60 s (`router.refresh()`), paused while the edit form is open
so a refresh never wipes typing. The worker needs `NODE_ENV=production` on
the VPS: `pino-pretty` is a dev dependency and is only loaded outside
production.

**Revisit when:** a waitlist wants to be told about releases (emit an event
from the expiry tx), or when the verification queue needs a "stale claims"
view for orders sitting in `pending_verification` past their hold.

---

## ADR-014 — Fulfilment: approve is one transaction to `issued`, email hooks after commit, rejection reasons on the order

**Date:** 2026-09-19 · **Status:** Accepted

**Context:** Invariant 4 names `fulfilment.service.ts` as the only code
that marks an order paid and issues tickets. The design (B8) says approving
"issues N tickets and emails them immediately", rejecting requires a reason
from a fixed list the buyer then reads, and two admin tabs may act on the
same order.

**Decision:**

- **Approve = `pending_verification → paid → issued` in ONE transaction**:
  lock the order (`SELECT … FOR UPDATE`) → `paid` + audit row →
  `inventory.convertToSold` (its one and only call site) → one ticket row per
  attendee name captured at registration → `issued` + audit row. `paid`
  stays in the state machine as the legal intermediate but never persists
  on its own in normal operation. A ticket-code UNIQUE collision rolls the
  whole transaction back and retries with fresh codes (×3).
- **The email is an after-commit port.** `onTicketsIssued(orderId)` is
  injected; the container passes a log-only implementation until the email
  slice replaces it with a queue producer. Its failure is logged, never
  surfaced — the tickets are real and the email can be re-sent (Invariant
  7: nothing network inside the transaction).
- **Reject requires a reason from a fixed list** (`rejection-reasons.ts`;
  labels are the buyer-facing wording) and an optional note shown word for
  word. Both are stored on the order (`rejection_reason`,
  `rejection_note`, migration `0005`) _and_ in the audit note; inventory is
  released in the same transaction, after the status flip, so a double
  reject can never double-release.
- **Approve carries the trxID the admin verified.** A buyer may edit the
  trxID while `pending_verification` (ADR-013). Approving by order id alone
  would issue tickets against a swapped id and free the verified one for a
  second order — one payment, two orders. The action binds the trxID the
  page showed; the service compares it under the row lock and refuses with
  `TrxIdChangedError` so the admin looks again. Found in review.
- **Concurrency is settled by the row lock and the conditional UPDATE**: of
  two simultaneous approves exactly one issues tickets; approve × reject
  yields exactly one of {tickets, release}; approve × buyer-edit never
  issues against an unverified id. All three proven against Postgres.
- An order whose attendee names no longer match its quantity is refused
  (`AttendeeNamesMismatchError`), never padded — that is corruption.
- **Ticket codes** are `TKT-` + 8 unambiguous characters — the code is the
  access key of the web ticket page, so it is longer than an order
  reference.
- **The actor** on admin audit rows is the admin's email from the session,
  passed in by the action (services never touch auth, ADR-004).
- The design's "trxID seen before" chip is not built: the UNIQUE index
  already makes two orders with one trxID impossible.

**Consequences:** `paid` orders should never be observed; if one is, a
transaction failed between the two transitions and the row lock protected
it — investigate, do not "repair" by hand. Cancelling a ticket (Phase 6)
must release exactly one seat via the same inventory primitive.

**Revisit when:** issuing needs to be deferred from approval (e.g. a
separate "generate tickets" job), or when partial approval (fewer tickets
than paid for) is ever requested — neither is planned.

---

## ADR-015 — The web ticket: code as access key, on-demand PDF, rename until close, a QR without a scanner

**Date:** 2026-09-19 · **Status:** Accepted — the "no scanner" parts superseded by [ADR-030](#adr-030--gate-scanner-slice-a-gate-passes-one-atomic-check-in-a-self-hosted-decoder)

**Context:** Each issued ticket needs a page the attendee can show and
print (A5/C5), and the business rule says the buyer may edit the attendee
name until registration closes. CLAUDE.md rules "all I/O is queued" and
"no QR scanning at the gate".

**Decision:**

- **`/tickets/<code>` is keyed by the ticket code** (`TKT-` + 8 chars of a
  31-symbol alphabet, ~40 bits). It shows attendee, event, type and code —
  never the buyer's email or phone — and names the order reference as text,
  not a link, because the order page carries PII. Rate limiting the path is
  Phase 7 hardening.
- **The PDF renders on demand** (`GET /tickets/<code>/pdf`,
  `@react-pdf/renderer`, `serverExternalPackages`). One ticket is a single
  ~5 KB document with no external I/O: a page view, not the bulk work the
  "queue all I/O" rule protects against. The whole order's tickets are in
  the file, the requested one first. The component is plain React under
  `src/server/pdf/` so the email worker can attach the same document.
- **A `position` column on tickets** (migration `0006`, 1-based, fixed at
  issue) makes "ticket 2 of 3" stable — rows share a `created_at` and codes
  are random, so nothing else orders them. `0007` (custom) backfills
  existing rows by issue order; `0008` adds UNIQUE `(order_id, position)`
  and `CHECK (position >= 1)` so the fact lives in the database.
- **The PDF bundles Noto Sans + Noto Sans Bengali** (OFL) and picks the
  face per text run by script: react-pdf's built-in Helvetica is
  WinAnsi-only and renders a Bengali name as Latin-1 garbage — for a Dhaka
  audience that is most of the door list. Fonts load from disk, never the
  network (Invariant 7). Found in review.
- **Rename is allowed while `issued` and `now < registration_closes_at`**
  (a missing close date locks, never opens). It is a compare-and-swap
  UPDATE on `status = 'issued' AND attendee_name = <old>` plus an
  `order_events` row (`buyer / ticket.renamed`, "old → new") — not a status
  change, but the first thing Raj will ask at the door; the CAS means the
  audit row's old name is exact and a concurrent rename is refused, not
  overwritten. Anyone holding the code can rename — the business rule says
  "the buyer", but tickets are transferable and the code _is_ possession.
  The name rule (2–120, whitespace collapsed) lives in `attendee-name.ts`
  and is shared by Zod and the service.
- **The QR encodes the ticket code and nothing else**, generated
  server-side as SVG. Door staff work from the printed list by name and
  code; copy on page and PDF says so. It is a convenience for reading the
  code, never the only way in, and there is no scanner to build.
- `/tickets/<code>/calendar.ics` is a hand-built single VEVENT (UID = code).

**Consequences:** No storage of rendered PDFs; a buyer can regenerate one
forever. At most two PDFs render concurrently per process (a burst queues
rather than starving the order pages); `Cache-Control: private, max-age=60`.
Cancelled tickets render greyscale with a stamp (cancel itself is Phase 6).
The `.ics` folds by UTF-8 octets on code-point boundaries (RFC 5545 §3.1).

**Revisit when:** the check-in list (Phase 6) wants something beyond name +
code, or a scanner is ever requested (then the QR payload becomes signed).

---

## ADR-016 — Transactional email: SES behind a Mailer port, sent by the worker, audited per message

**Date:** 2026-09-20 · **Status:** Accepted

**Context:** Four emails are designed (C1 payment instructions, C2 tickets

- PDF, C3 rejected, C4 expired). Invariant 7 forbids network calls inside
  transactions; CLAUDE.md says all I/O is queued. The provider must be cheap
  at ~1,500 messages/month and must not drop messages on a launch-day spike
  (the free tier first considered capped at 100/day).

**Decision:**

- **Amazon SES**, region `ap-south-1`, via `@aws-sdk/client-sesv2` with raw
  MIME built by nodemailer's `MailComposer` (the only sane way to attach the
  ticket PDF). Cents per month; the sandbox → production request is the one
  manual step. `resend` was removed as never used.
- **A `Mailer` port** with two adapters: `ses` and `log` (pino + files in
  `tmp/emails/`). `MAILER` selects; the worker refuses to start in
  production with anything but `ses`, because a logged send is not a send.
- **Services never send.** Each state change exposes an after-commit hook
  (`onOrderCreated`, `onTicketsIssued`, `onOrderRejected`, `onOrderExpired`);
  the container wires them to `enqueueEmail(kind, orderId)`. A hook failure
  is logged and swallowed — an order that could not be announced is still
  an order, and Raj can re-send.
- **The worker renders and sends.** Job `email.<kind>` `{ orderId }`;
  deterministic id `<kind>__<orderId>` dedupes double enqueues (BullMQ
  forbids `:` in custom ids — found live); re-sends get a timestamp suffix.
  Five attempts with exponential backoff from 30 s; SES throttling maps to
  `MailerThrottledError` and is retried; the worker's limiter is 5/s.
- **The order's status is re-checked at send time** (`email.skipped` when
  it no longer fits — C2 only for `issued`), and **every send writes
  `order_events` `email.sent`** with the kind and provider message id;
  the final failed attempt writes `email.failed`. B8 answers "did they get
  it?" from the same audit trail as everything else.
- **Templates are `@react-email/components`** (tables, inline styles,
  600 px, system fonts) with a plain-text alternative; the QR is not
  embedded (hosted images hurt deliverability — the ticket page and PDF
  carry it).
- **The worker is bundled with esbuild** (`dist/worker.mjs`, ESM, packages
  external) and run by plain Node. tsx's CJS loader mis-resolves
  react-pdf's nested ESM exports (`@react-pdf/hyphenate/en-us`); a built
  artifact is also what the VPS should run.

- **Nothing after a successful send may fail the job.** The `email.sent`
  audit insert is wrapped: a Postgres blip there is logged (with the
  provider id) rather than thrown, because a retry would re-send and SES
  has no idempotency key. Permanent SES errors (rejected message, unverified
  domain, suspended account) map to BullMQ's `UnrecoverableError` — one
  `email.failed` row, no pointless retries; throttling and daily-quota
  errors are retried.
- **The app's producer connection fails fast** (`enableOfflineQueue: false`,
  2 s connect timeout, 3 s enqueue timeout) so a Redis outage can never
  hang a registration request; the hook logs and the order stands.
- C1 is skipped once `hold_expires_at` has passed even if the row is still
  `pending_payment` — a late job must not ask for money on a lapsing hold.

**Consequences:** `REDIS_URL` is now required by the app too (it enqueues).
C1 doubles the per-order message count — fine at SES prices. DNS (DKIM ×3,
SPF, DMARC) and Cloudflare Email Routing for `hello@` are documented in
ENVIRONMENT.md; until production access is granted only verified addresses
receive mail. `dist/worker.mjs` must run from the repo root (fonts are read
from `src/server/pdf/fonts`).

**Revisit when:** bounces/complaints need handling (SES → SNS → a
suppression list), or a second organizer wants their own sending domain.

---

## ADR-017 — Buyer access: one name per order, Find my order, optional passwordless accounts

**Date:** 2026-09-20 · **Status:** Accepted

**Context:** A buyer who closed the tab before paying had no way back
except the C1 email. Accounts were wanted but must never be required to
buy. Asking for a name per ticket was friction nobody needed at registration.

**Decision:**

- **One name per order.** The form takes the buyer's name only; the Zod
  schema fills `attendee_names` with it for every ticket, and the service
  still enforces names === quantity. Tickets stay named and transferable:
  each ticket's name is editable on its own page until registration closes.
- **Find my order** (`/orders/find`) needs no account and no email: the
  reference (which the buyer typed into bKash) plus the phone used at
  registration, normalised with the same rule. One generic message for any
  mismatch; the reference is not a secret, but which phone it belongs to is.
- **Optional accounts are passwordless.** better-auth's `magicLink` plugin:
  `/account/sign-in` emails a 15-minute link (through the worker, like every
  email — Invariant 7); the first sign-in creates the account. **My orders**
  (`/account`) lists orders whose `buyer_email` equals the session email —
  proof of the email is the access rule, so past orders are covered without
  a `user_id` column. Registration pre-fills name/email when signed in.
- **Roles.** `users.role` (`admin` | `buyer`, migration `0009`, never
  settable from a request). Before this slice "a session exists" meant
  "is the admin" (sign-up was off); now sessions are free to obtain, so
  **every admin server action calls `requireAdmin()` itself** — the
  `(protected)` layout only guards page renders, and a server action is
  its own POST endpoint. A buyer session at `/admin` is sent home. Admins keep the password login only: a
  magic link requested for an admin email is silently not sent (the
  endpoint still says "sent", so admin emails stay unenumerable).
  `admin:create` sets the role; `admin:promote` exists for the admin created
  before the column.
- **Throttling is ours, not better-auth's.** better-auth's limiter runs
  only in its HTTP handler (and only under `NODE_ENV=production`, in
  memory); the UI calls `auth.api.signInMagicLink` directly, which
  bypasses it. `src/server/lib/rate-limit.ts` is a Redis fixed-window
  counter: sign-in links 10/min per IP and 3/15 min per address (Redis
  down → refused, since the email could not be queued either); Find my
  order 20/min per IP (Redis down → allowed, it only reads Postgres).
- **Test seam:** `E2E_EXPOSE_MAGIC_LINK=1` shows the link on the sign-in
  page so Playwright can follow it — a positive gate on `APP_ENV=test`
  (what the Playwright web server sets), so a staging or production box
  that inherits the flag never shows a link; `NODE_ENV` plays no part
  because `next start` forces it to `production` even for the e2e build.
  The e2e server also runs with `BETTER_AUTH_URL` on its own port, because
  the verify endpoint redirects to `callbackURL` on that origin.

**Consequences:** Every public page reads the session (they were already
dynamic). The `magicLink` plugin must be passed to `betterAuth()` as a
concrete value (`magicLinkPlugin()`), not inside the widened
`BetterAuthOptions`, or `auth.api.signInMagicLink` is erased from the type.
**Deploy order matters once:** migration `0009` defaults every existing
user to `buyer`, so run `pnpm admin:promote <email>` right after it or
the admin is bounced to the home page until someone does.

**Revisit when:** buyers want to change the email on an order (then a
`user_id` link and an admin tool), or a second organizer needs their own
admin.

---

## ADR-018 — Static pages: copy in TSX, contact from env, a native accordion

**Date:** 2026-09-20 · **Status:** Accepted

**Context:** The registration checkbox said "I agree to the terms" with no
terms page behind it; tickets and emails said "refunds are handled outside
the app" with no policy to point at. The design (canvas 2, A7) fixes one
long-form template for About/Terms/Privacy/Refunds/Contact and a FAQ
accordion whose rows are shareable anchors.

**Decision:**

- **Copy lives in TSX**, not a CMS, MDX or the rich-text editor. Six pages
  that change a few times a year; a `StaticPage` template
  (`src/components/public/static-page.tsx`) plus a JSX body per page is
  typed, reviewable in a diff, and needs no dependency. The body reuses the
  `.rich-text` styles from globals.css so a policy reads exactly like an
  event description — one prose style for the public site. ADR-010's
  editor stays for organizer-authored event copy only.
- **Every number a page promises is a constant in `src/content/site.ts`**
  (verification SLA, hold hours, refund working days, rename cut-off) and
  the order page imports the SLA from there too. When the organizer changes
  a promise, it changes everywhere at once. The FAQ items are data in
  `src/content/faq.tsx`; their ids are permanent anchors.
- **Contact details come from the environment** (`ORGANIZER_CONTACT_EMAIL`,
  `ORGANIZER_PHONE`, `FACEBOOK_PAGE_URL`) through `ContactCard`, which
  omits each unset channel and renders nothing when none is set; `/contact`
  says so instead of showing a blank.
- **FAQ = native `<details name="faq">`.** The HTML exclusive-accordion
  attribute gives "one open at a time" with no JavaScript; the only client
  code opens the item named in the URL hash (browsers scroll to an anchor
  but do not expand a closed `details`). The question text toggles; a
  separate `#` link sets the hash, so a link inside the summary never
  fights the toggle.
- **The copy is a draft the organizer signs off**, not legal advice. The
  refund promises (bKash transfer within three working days; full refund on
  cancellation or postponement) and the 4-hour SLA come from the design
  frames and PROGRESS.md lists them for confirmation. Terms name the law of
  Bangladesh and no legal entity; both are placeholders until confirmed.

**Consequences:** Pages are static server components with canonical URLs
and are indexable (unlike order and account pages). Changing copy is a
code change with a `LAST_UPDATED` bump. Browser support for `details
name=` is Chrome 120+, Safari 17.2+, Firefox 130+; older browsers get an
accordion where several rows can be open, which is harmless.

**Revisit when:** the organizer wants to edit copy without a deploy (then
a `site_pages` table behind the existing rich-text editor), or a second
language arrives (post-launch Bangla).

---

## ADR-019 — Archive read model, error reference from Next's digest, auth limiter off only in e2e

**Date:** 2026-09-21 · **Status:** Accepted, partly superseded by [ADR-048](#adr-048--bot-check-cloudflare-turnstile-on-the-public-forms) (better-auth's `/sign-in*` limiter never covered the admin login, which calls `auth.api`; the login now has its own limiter, and `/sign-in/email` is disabled)

**Context:** The last Phase 2 screens: A6 `/archive` and the A8 500 page.
Plus two e2e flake causes found on 20 Sep that made every full run fail
first time.

**Decision:**

- **Archive = the home page's past rule, uncapped.** `selectArchiveEvents`
  sits next to `selectHomeEvents` (`src/server/lib/home-events.ts`) with
  the same membership (started before now, published or archived, never
  draft — an archived _future_ event was pulled on purpose), so "See all
  past events" can never show fewer than the strip. One events query, no
  capacity query: nothing in the archive is on sale.
- **Error reference is Next's `digest`.** Next attaches a digest to every
  server error and prints it in the server log, so `ERR-<first 8>` on the
  page is already greppable — no logging plumbing, no error table. A
  client-only error has no digest and gets a one-off random reference
  from lazy `useState` (the React-compiler lint forbids reading refs in
  render). Three boundaries share one `ErrorPage`: the public group
  (inside the shell), the admin group (admin wording, "Back to
  dashboard"), and `global-error.tsx` for a failed root layout.
- **better-auth's limiter stays on in production and off in e2e.**
  `rateLimit.enabled` is `NODE_ENV === 'production'` unless
  `APP_ENV === 'test'`. Its `/sign-in*` rule (3 per 10 s per IP) is real
  brute-force protection for `/admin/login`; the Playwright build is also
  a production build but signs in as the admin from six workers at once.
  The long verification spec gets `test.slow()`.

**Consequences:** In production behind a proxy, better-auth needs the
client IP header (`advanced.ipAddress.ipAddressHeaders`, e.g.
`cf-connecting-ip`) or every visitor shares one sign-in bucket — a Phase 6
deployment item, noted in the RUNBOOK plan. The archive is dynamic like
the home page.

**Revisit when:** attendance counts land on archive cards (Phase 6
reports), or a maintenance page is needed (reverse proxy, Phase 6).

---

## ADR-020 — Public design pass to the approved canvas

**Date:** 2026-09-21 · **Status:** Accepted — the home page and header
parts superseded by
[ADR-032](#adr-032--home-navigation--sponsors-canvas-6-logos-through-the-server-one-offer-rule-a-path-aware-header)

**Context:** The public site was functionally complete but read as a
demo: a hero in a card, a grid of six identical cards, three empty trust
boxes, a one-row footer, an event page with an empty right column. A
Claude Design canvas (four artboards: home and event at 1440 and 390)
was approved on 21 Sep and this pass makes the code match it.

**Decision:**

- **Same tokens, more contrast.** Nothing new in `globals.css`: the pass
  uses the existing palette and type scale but alternates light and
  charcoal full-bleed bands (hero, trust band, footer) so the page has
  rhythm. Archivo display sizes go up to 64px on the hero only.
- **The header's "Get tickets" comes from the home read model.**
  `src/app/(public)/home/load.ts` wraps `eventsService.getHomePage()` in
  React `cache()`; the public layout reads the featured event's slug and
  phase from it and the home page reads the rest — one query per request,
  no new repository method. The button is omitted (not disabled) when
  nothing is on sale.
- **Home caps.** "Also upcoming" renders at most three cards on the home
  page (the selector still returns six for a future events list); the
  past strip shows four. `HomeEvent` gained `availableTotal` for the
  hero's "N left" — computed from the capacity roll-up already fetched.
- **Event page: the band is the cover.** On desktop the cover is the
  darkened backdrop behind title/date/venue; on phones it sits above the
  band. The tickets card is rendered twice (inline on phones, sticky on
  desktop) with the CTA only in the desktop copy — the phone has the
  bottom bar. The "deal" row (open type whose sales end soonest) is
  tinted marigold; there is no Early Bird flag in the data model.
- **Icons are inline stroke SVGs** (`home/icons.tsx`), no icon font, no
  emoji. Mobile nav is the shadcn Sheet, like the admin.

**Consequences:** e2e selectors that assumed one occurrence of the venue
or the cover now target the visible copy (`event-cover` is the desktop
backdrop, `event-cover-mobile` the phone image; the footer nav is
`Site pages`, the header nav `Site` with `exact: true`). The dormant
home state (`NoLiveEvent`) was already charcoal and is unchanged.

**Revisit when:** real cover photos land (the date tile and scrim were
tuned on placeholders), or an "All events" list page exists to link the
"Also upcoming" heading to.

---

## ADR-021 — Orders list (B9): normalised search, URL state, CSV as a route handler

**Date:** 2026-09-21 · **Status:** Accepted

**Context:** After verification, an order had no page to be found from.
Raj needs "which order was this TrxID?", "did this buyer's email bounce?",
"how many orders did event X take?", and a spreadsheet of the answer.

**Decision:**

- **The search term is normalised exactly like the stored data, then
  matched by equality.** `normaliseSearchTerm` (`src/lib/validation/
orders-search.ts`) runs the same rules registration used: reference →
  `EA-` + upper, trxID → upper, phone → E.164 via `bdMobile`, email →
  lower. Every interpretation that parses is kept and the repository ORs
  them (`reference = … OR bkash_trx_id = … OR buyer_phone = … OR
buyer_email ILIKE %…%`). Identifiers hit indexes; only the email is a
  substring scan (LIKE wildcards escaped). No trigram or full-text search:
  a single organizer's table is thousands of rows and the identifiers are
  exact by nature. The service names which interpretation each row
  satisfied (`matchedField`) so the UI can tint that cell.
- **The URL is the state.** A plain GET form; `q`, `status`, `event`,
  `from`, `to`, `page` are parsed by a lenient schema (bad values fall
  back to "no filter", never a 400). Back button, bookmarks and the CSV
  link all carry the same query. Date bounds are Dhaka calendar days,
  `to` inclusive. Page size 25; an out-of-range page clamps to the last.
- **CSV export is a route handler** (`/admin/orders/export.csv`), not a
  server action: a download needs headers and a filename. It calls
  `requireAdmin()` itself (ADR-017's rule), applies the same filter with
  a 10 000-row cap, and returns RFC 4180 CSV with a UTF-8 BOM (Excel +
  Bangla) and CRLF; cells starting with `= + - @` are prefixed with `'`
  so a buyer's name can never become a spreadsheet formula. Money is a
  plain decimal column (`formatDecimalBDT`) so it sums.
- Indexes added on `orders.buyer_email`, `buyer_phone`, `created_at`
  (migration 0010); `reference` and `bkash_trx_id` were already unique.

**Consequences:** `bdMobile` is now exported from `validation/orders.ts`.
The verification queue keeps its own unbounded query. `toCsv` is shared
with the check-in export (next slice). The dashboard's "recent orders"
(B3) can reuse `searchOrders` with an empty filter.

**Revisit when:** a second organizer or > ~100k orders make the email
scan slow (then a trigram index), or Raj asks for saved views.

---

## ADR-022 — Admin data table: TanStack Table in server-controlled mode; status totals

**Date:** 2026-09-21 · **Status:** Accepted

**Context:** Three hand-rolled admin tables (events, verification, orders)
with two more coming (check-in list, reports). Wanted: sortable columns,
column visibility, later row selection, and one component instead of
five. Also wanted on the orders page: totals by status.

**Decision:**

- **`@tanstack/react-table` 9.2.4**, admin only, through one client
  component `src/components/admin/data-table.tsx`. v9's feature-based API
  (`tableFeatures({ rowSortingFeature, columnVisibilityFeature })`,
  `useTable`, `createColumnHelper`) is what shipped; the `adminColumnHelper`
  wrapper pins the feature set so column files stay short.
- **Server-controlled, always.** The page fetches, filters, sorts and
  paginates; the table renders the rows it is given (`manualSorting`) and
  owns only column visibility. Nothing is ever filtered or paginated in
  the browser — the whole orders table would otherwise be shipped to it.
- **Sorting is a link.** `?sort=<column>:<asc|desc>` parsed against a
  per-page whitelist (`src/lib/table-sort.ts`, `parseSort`); the header
  renders a `<Link>` to the next state (`nextSort`: new column starts in
  its natural direction, same column flips). Works without JavaScript,
  the back button undoes it, the CSV export sees the same order. The
  repository maps the whitelisted name to a column (`sortOrder`) with an
  `id` tiebreak so pages stay stable. Unpaginated lists (events,
  verification) sort on the server in memory from the same URL param.
- **No functions across the server → client boundary.** Rows are plain
  serialised objects with their own `id` and pre-formatted labels; the
  table receives `sortBase: { pathname, query }` and builds hrefs itself.
  (The first cut passed `getRowId`/`sortHref` callbacks and crashed with
  "Functions cannot be passed directly to Client Components".)
- **Column visibility** is a per-viewer convenience in `localStorage`
  (`admin.table.<id>.columns`), read through `useSyncExternalStore` so
  the server render and the first client render agree and the React
  compiler's no-setState-in-effect rule holds. The "Columns" menu is the
  shadcn dropdown; Base UI requires its `GroupLabel` inside a `Group`.
- **Phone layouts keep their card lists**; the DataTable is `hidden
lg:flex`.
- **Status totals** (`orders/status-totals.tsx`): one `GROUP BY status`
  query (`totalsByStatus`) for the current event/date/term filter with
  `status` ignored; tiles double as the status filter (active tile links
  back to "all"). **Revenue = paid + issued only**; pending sums are
  labelled "held", rejected/expired "not taken"; cancelled is a count,
  never "refunded" — refunds happen outside the app. `summariseTotals`
  is unit-tested for exactly that rule.

**Also fixed on the way:** the admin dashboard ran one ticket-types
query per published event (`listForEvent` in a `Promise.all`); with the
dev database at ~260 published test events every sign-in landed on a
page doing 260 queries, which is what had been making the e2e sign-ins
time out. Now `listForEvents` — one `IN` query. And the e2e suite runs
on its own database (`tests/e2e/prepare-db.ts`: create, migrate,
truncate, seed the admin, refuse any name not ending in `_e2e`) instead of
growing the dev database run after run.

**Consequences:** one dependency; `columns.tsx` per table; the events
and verification pages are on the same component. Row selection and bulk
actions arrive with the check-in list.

**Revisit when:** a table needs client-side interactivity beyond
visibility (inline edit, drag), or a list grows past what one server
query per page handles.

---

## ADR-023 — Check-in list (B11): unpaginated in-memory list, a separate print sheet, partial lists label themselves

**Date:** 2026-09-21 · **Status:** Accepted — the list is now the backup to the gate scanner ([ADR-030](#adr-030--gate-scanner-slice-a-gate-passes-one-atomic-check-in-a-self-hosted-decoder))

**Context:** Check-in at the gate is a printed or exported list (no QR
scanning). Door staff need one sheet per event with attendee, ticket type,
code and order reference, a box to tick, and the same as a CSV. The list
is looked up by name, but people also read out a code or a reference.

**Decision:**

- **Whole list, no pagination.** `ticketsRepository.listForEvent` returns
  every ticket of the event (all statuses, joined to the order reference
  and type name — never the buyer's email or phone: the sheet is handed
  around). The service keeps `issued` only, counts `cancelled` for the
  footer, and searches and sorts **in memory** from the URL (`?q=&sort=`)
  with the pure helpers in `src/server/lib/check-in.ts`. A door list is
  bounded by the event's capacity and has to be printed whole, so there is
  nothing to paginate; a cap with a warning row (as the orders export has)
  is the change to make if an event ever runs to tens of thousands.
- **One term, every reading.** `normaliseCheckInQuery` reads a term as a
  name substring (case- and whitespace-insensitive, so Bangla names work),
  as a ticket code (`TKT-` optional, spaces ignored — codes are read aloud
  in groups) and as an order reference (`EA-` optional); every reading that
  parses is kept and ORed, as the orders search does (ADR-021).
- **The print sheet is its own table**, `hidden print:block`, not print CSS
  on the DataTable: that table is `hidden lg:flex`, and an A4 page is
  narrower than `lg`, so in print it would vanish and the phone list would
  print instead. The sheet is always **name A–Z** whatever the screen is
  sorted by, has a 28 px tick box, a repeating `<thead>`, the count and the
  time the data was read ("as of"), and the footer from the design.
  **Page numbers are not printed**: they need `@page` margin boxes, which
  Chrome and Safari do not implement.
- **A filtered list is never printed silently.** The Print button is
  disabled while a search is in force, and because ⌘P bypasses the button
  the sheet labels itself "Partial list — search … applied" with
  "N of M names". A subset that looks like the whole list turns paying
  attendees away at the door; found in review.
- **CSV** (`/admin/events/[id]/check-in/export.csv`) mirrors the orders
  export: `requireAdmin()` in the handler, `toCsv` (BOM, CRLF, formula-safe),
  the same search and sort as the page, and an empty `checked_in` column to
  tick in a spreadsheet. The log records that a filter was used, not the
  term (it is usually a name).
- **No row selection yet.** The design's on-screen tick column would
  persist nothing; selection arrives with cancel ticket, when there is
  something to do with a selection. Entry point: a "Check-in list" button
  in the event editor header for published and archived events (the
  archived design promises the list stays available); no sidebar item.
- **`SearchBox`** (`src/components/admin/search-box.tsx`) is the debounced
  search extracted from the orders toolbar. It follows the URL when the URL
  moves without it (a Clear link, the back button, a superseded push) and
  never overwrites a term still being typed; the toolbar's own Clear
  remounts it so a pending debounce dies with it. The first cut re-applied
  a stale term after a soft navigation — a flake in the full e2e run, and
  a real bug.

**Consequences:** Ticket codes on paper are access keys to the web ticket
page (by design, ADR-015); the sheet can be printed before registration
closes, so a name printed early may be renamed later — the footer says to
reprint on the day. `TicketsRepository` gains one read method; the fake in
`tests/unit/helpers/fake-db.ts` mirrors it.

**Revisit when:** an event's capacity makes the unpaginated page heavy
(cap + warning, select only the columns the list needs), or door staff
want to mark arrivals in the app (then row selection and a
`checked_in_at` column).

---

## ADR-024 — Cancel ticket: a fourth inventory primitive, order locks are NO KEY UPDATE, the last ticket cancels the order

**Date:** 2026-09-21 · **Status:** Accepted

**Context:** "Admin can cancel a ticket, which releases inventory; money is
returned outside the system." Everything downstream already understood a
cancelled ticket (page and PDF stamp, rename refused, C2 re-send lists
live tickets, check-in list counts it); the write was missing.

**Decision:**

- **`inventory.releaseSold`** is the fourth conditional UPDATE in the
  repository (`quantity_sold = quantity_sold - $n WHERE quantity_sold >= $n`,
  backstopped by `ticket_types_sold_nonneg`). A cancelled ticket was paid
  for and converted to SOLD at approval; `release` works on the HELD counter
  and would free a seat some unpaid order still holds. Only
  `fulfilment.service.ts` calls it.
- **`fulfilmentService.cancelTicket`** is one transaction: lock the order
  (it must be `issued`) → lock the ticket (it must be on that order — a
  ticket id from another order is "not found", so a forged pair cannot
  cross orders) → conditional `issued → cancelled` on the ticket → only
  then `releaseSold(1)`, so a lost race releases nothing → audit row
  `ticket.cancelled` with the code, the attendee and a **required reason**
  (Invariant 6: "why" is answerable from the database). When it was the
  order's last live ticket the order follows, `issued → cancelled` (its one
  legal exit), with an `order.cancelled` row in the same transaction. A
  partially cancelled order stays `issued` and its revenue stays counted —
  money was received; the refund happens outside the app (the cancelled
  tile reads "returned outside").
- **Order row locks are `FOR NO KEY UPDATE`**, not `FOR UPDATE`. Review
  found a reproducible deadlock: a buyer's rename holds the ticket row and
  then inserts its `order_events` row, whose FK takes `KEY SHARE` on the
  order; an admin cancel holds the order `FOR UPDATE` and waits for the
  ticket. `NO KEY UPDATE` still excludes every other order writer (approve,
  reject, submit, cancel all take it) but does not conflict with an FK
  `KEY SHARE` — nobody updates an order's key. Belt and braces: rename now
  locks the order first too, the same order cancel and approve take. An
  integration test drives the exact interleaving and fails on `FOR UPDATE`.
- **No cancellation email.** C1–C4 are the designed messages; the admin
  is already talking to the buyer. A C2 re-send after a partial cancel
  lists and counts live tickets only, but keeps "Ticket 2 of 3" as the
  ticket's fixed place in the order (ADR-015), matching the PDF and page.
- **Out of scope:** "Cancel order" from `pending_payment` (not in the
  state machine), a time guard (cancelling after the event is harmless
  for inventory), bulk cancel / row selection.

**Consequences:** `TicketsRepository` gains `findByIdForUpdate`, `cancel`
(the one ticket status write, conditional) and `countIssuedByOrder`
(transaction-only: it must see the cancel that just happened). The B8 page
shows a per-ticket Cancel while the order is `issued` and a read-only note
once it is `cancelled`. The check-in list's "N cancelled tickets not
listed" is now reachable.

**Revisit when:** Raj wants buyers told (a C6 "ticket cancelled" email
after commit, like C3), or an un-cancel is requested (it is not: a
cancelled seat may already be resold — the buyer registers again).

---

## ADR-025 — Settings (B14): one typed row, env as the fallback, read per request and per email job

**Date:** 2026-09-21 · **Status:** Accepted

**Context:** The bKash number, support contact, Facebook page, verification
promise and organizer name were env variables and `site.ts` constants, and
"Raj" was a literal in three email templates. The organizer could not change
his own receiving number without a deploy. Design B14 is one screen with
those fields, each helper naming where the value appears.

**Decision:**

- **A single typed row.** `settings` has a column per field and
  `CHECK (id = 1)`, not a key/value table: every consumer gets a typed
  `SiteSettings` and the compiler knows which fields exist. All value
  columns are nullable — **NULL means "use the fallback"**.
- **Env is the seed, the row is the truth.** Until the organizer has saved
  once, `resolveSettings` (pure) reads `BKASH_RECEIVE_NUMBER`,
  `ORGANIZER_CONTACT_EMAIL`, `ORGANIZER_PHONE` and `FACEBOOK_PAGE_URL`, so a
  fresh database (CI, the e2e database, a new install) behaves exactly as
  before with no seed step, and the form pre-fills those values. The first
  save copies them into the row; **after that a NULL column means "none"**
  (hide the Facebook link, no phone), never "go back to env" — the first cut
  did fall back per field, and clearing the Facebook link was silently
  undone on the next render (found in review). The verification promise and
  the organizer name are required on the form; their `site.ts` constants
  remain only for a row that predates the rule.
- **Read per request in the app** (`getSiteSettings`, React `cache()` — one
  query however many components ask) and **per job in the worker**
  (`DispatchEnv.settings()`), so a change is live on the next page and the
  next email with no restart. The cost is one single-row SELECT per request.
- **Account type drives buyer wording.** `bkash_account_type`
  (`personal` | `merchant`) flips "Send Money" ↔ "Payment" on the order page
  and in C1, and the account name is shown beside the number so a buyer can
  check who they are paying. Numbers are stored in the display form
  "01712 345678" (normalised through the same `bdMobile` rule registration
  uses) — the form people copy into bKash; `tel:` links strip the space.
- **Templates take a `sender`** (`EmailSender`: site URL, support email and
  phone, organizer name and address) instead of three loose props, and the
  organizer's name replaces the "Raj" literals. `ContactCard` and the
  check-in print sheet take settings as a prop so they stay pure.
- **Who saved it** is on the row (`updated_by`, `updated_at`) and in the log
  (which fields changed, never the values). No history table.
- **Not built:** the design's "Send myself a test email" (`pnpm email:test`
  covers it for now); `REPLY_PROMISE` and the policy constants that mirror
  code rules (`HOLD_HOURS`, `REGISTRATION_CLOSES_DAYS_BEFORE`,
  `REFUND_WORKING_DAYS`) stay in `site.ts` — they are not organizer choices.

**Consequences:** Migration `0011` must run before the app boots — `get()`
on a missing table throws. `SiteShell`, the public layout and every public
page that quotes a setting are async server components reading
`getSiteSettings()`. The e2e database truncates `settings` per run. Deleting
the row is the way back to the env seed; blanking a field means "none".

**Revisit when:** Raj asks "what was it before" (a `settings_history`
table or audit rows), a second organizer needs their own settings, or the
test-email button is wanted (a queue job kind, not a synchronous send).

## ADR-026 — Sales report (B12): read-only aggregates, the audit trail is the clock, B9's money vocabulary reused

**Date:** 2026-09-22 · **Status:** Accepted

**Context:** Orders (B9) and the check-in list (B11) answer questions one
row at a time; "how is this event selling" needed one screen. The B12
artboard gives a skeleton (event selector, four StatCards, daily bars,
sold-per-type table, export); the user asked for a fuller report
dashboard. Every figure had to be derivable truthfully from what the app
already stores — no new tables, no estimates.

**Decision:**

- **A `reports.repository` of aggregate reads only** (one statement each,
  scoped to an event), a `reports.service` that runs them in parallel and
  assembles one typed `SalesReport`, and a pure `lib/sales-report.ts` for
  the arithmetic (windows, zero-filled series, deltas, funnel, histograms)
  so it is unit-tested without a database. Nothing is cached: the report
  is live on every load. `PrintButton` moved to `components/admin`.
- **One definition of revenue.** `REVENUE_STATUSES` (`paid`, `issued`)
  now lives in `lib/order-status.ts` beside the state machine and is
  shared by B9's status strip and B12, so the two screens can never
  disagree. Pending money is "waiting", rejected/expired "never received",
  a cancelled order "returned outside the app" — never "refunded". A
  partially cancelled order stays counted (ADR-024).
- **Seats come from the inventory counters** (`quantity_sold` /
  `quantity_reserved`), the same numbers the public stock shows — net of
  cancellations — not from a count over orders. The daily and cumulative
  series, the period deltas and the "tickets per order" figures are the
  **gross verified quantity** (`SUM(orders.quantity)` — a partially
  cancelled order keeps its quantity, ADR-024), so they are labelled
  "verified", never "sold", and the cumulative caption quotes the net
  seat count beside them whenever the two differ.
- **The audit trail is the clock.** The day of a sale is the Dhaka date of
  the order's `payment.approved` row; time-to-pay is `order.created →
payment.submitted`, time-to-verify is `payment.submitted →
payment.approved` (medians via `percentile_cont`). No `paid_at` column:
  Invariant 6 already records those moments, the money path in
  `fulfilment.service.ts` stays untouched, and there is no migration.
  Dhaka buckets are computed in SQL (`AT TIME ZONE 'Asia/Dhaka'`, a
  literal — a bound parameter would not match between SELECT and GROUP BY).
- **"When people register" uses order creation** (every status): that is
  when buyers act; money figures use verified orders only.
- **Ranges** are 14/30/90 days ending today or "all" from registration
  opening (or the first sale, whichever is earlier). A delta compares the
  window with the same number of days before it and is never shown for
  "all". The overview lists the newest 12 events (the CSV has them all).
- **Not claimed:** complimentary tickets and discounts (Phase 5 — the
  discount line renders only when the sum is > 0), refund amounts (the
  app does not know them), any projection of final sales.

- **Charts are Recharts via shadcn's `Chart`** (B12.1, after the plain-div
  first cut): SVG (prints, scales, keeps the `sr-only` tables), themed
  hover tooltips, and it sits on the stack we already have — not Chart.js
  (canvas, imperative, its own theming). `recharts` is pinned exactly;
  `components/ui/chart.tsx` is CLI-generated and never hand-edited. The
  chart components only draw; every figure is still computed on the server.

**Consequences:** ~8 aggregate queries per page load over one event's
orders — trivial at this scale, and the existing `event_id` / `order_id`
indexes cover them. The dashboard's placeholder "Orders today / Revenue
today" can be wired to `reportsRepository.dailySales` in a follow-up.

**Revisit when:** an event lives long enough that "all time" bars get
dense (weekly buckets), B13 comps land (a fifth KPI and a line in the
table), or Raj wants the report emailed nightly (a queue job, not a page).

## ADR-027 — Promo codes (B10): per-ticket discount, priced only on the server, refused rather than dropped

**Date:** 2026-09-23 · **Status:** Accepted

**Context:** The schema carried `promo_codes`, `promo_code_ticket_types`,
`orders.promo_code_id` and `orders.discount_paisa` since Phase 0, but
nothing read or wrote a code. Business rule: percentage or fixed, unlimited
uses, restrictable to ticket types. Design: B10 (table + create sheet) and
A3 (an optional code field with Apply).

**Decision:**

- **The discount is per ticket.** A percentage takes `floor(price × pct /
100)` off each ticket (`percentOfPaisa` in `money.ts` — floor, so a
  discount is never a rounding paisa more than offered); a fixed amount
  takes `min(value, price)` off each ticket, so no ticket goes below ৳0.
  The order discount is that × quantity, still capped by
  `computeOrderTotals`. Matches the design's preview "A General ticket
  becomes ৳1,020.00". The rules live in pure `lib/promo.ts`, shared by the
  server and the A3 live preview.
- **Invariant 5 holds:** the client sends a code string, never an amount.
  `createOrder` resolves the code from the database, checks it is active
  and covers the chosen ticket type, and prices the order from the
  `ticket_types` and `promo_codes` rows. The order snapshots `discount_paisa`
  and `promo_code_id`; the `order.created` audit row names the code and
  the discount (Invariant 6).
- **One judgement, `judgePromo`, for Apply and submit** — they can never
  disagree. A code that does not apply is refused, not dropped:
  `PromoCodeNotValidError` is thrown before the hold, so a bad code never
  holds stock. A code typed but never applied is still sent and checked on
  submit. Unknown, switched-off and other-event codes all read "not valid
  for this event", so probing cannot tell them apart.
- **A code never makes a ticket free.** A ৳0 order cannot be paid by bKash
  and would sit held until it expired; free tickets are complimentary
  tickets (B13). Percentages are 1–99 (form + CHECK), and a fixed amount
  that would take a ticket's whole price is refused for that type
  ('makes_ticket_free'); the admin preview says so.
- **Every code check is throttled** — Apply _and_ a submit that carries a
  code share one 20/min per-IP budget. Without that, submitting against a
  sold-out type was an unthrottled way to test codes (found in review).
  Both actions validate their arguments with Zod and catch outages so the
  buyer's form survives. Submit prices again whatever Apply said.
- **Codes are global, and the scope is explicit.** No restriction rows =
  every ticket type in every event, so the form asks "Any ticket type" vs
  "Only these" and refuses "Only these" with nothing ticked — unticking the
  last type can never widen a code by accident. For the same reason the
  restriction FK is `ON DELETE RESTRICT`; the ticket-type delete tells the
  admin to take the type off the code first (switching the code off is not
  enough — the restriction row still exists).
- **The code text is fixed** after creation; type, value, restrictions and
  active can change and only affect new orders. A code any order used can
  be switched off but never deleted (`orders.promo_code_id` FK).
- **"Uses" = verified orders** (paid + issued, the B9/B12 vocabulary) with
  "+N pending" beside it, and "Discount given" over verified orders.
- Migrations `0012`/`0013`: `promo_codes_code_format` (the exact code
  pattern, so no row can exist that a normalised lookup would miss),
  `promo_codes_percentage_range` 1–99, `promo_codes_value_positive`, index
  `orders_promo_code_id_idx`, the FK change above, and
  **`orders_totals_consistent`** — `subtotal = unit × quantity`, `discount ≤
subtotal`, `total = subtotal − discount` — the database backstop for
  Invariant 5 now that discounts are live. One new UI primitive: shadcn
  `switch` (Base UI).

**Consequences:** A code changed or switched off between Apply and submit
prices the order by the rule at submit time (the rule is read just before
the order transaction). The buyer still sees the amount due on the order
page before any money is sent — nobody pays a price they were not shown.
Promo edits are logged with the actor but write no `order_events` row
(they are not order state changes). The B12 report's "Discounts of ৳X"
line now has data.

**Revisit when:** a code needs a usage cap or an expiry date (a counter
becomes an inventory-style race and needs the conditional-UPDATE pattern),
or codes need to be scoped per event rather than per ticket type.

---

## ADR-028 — Complimentary tickets (B13): a ৳0 order born `issued`, inside fulfilment; seats, not sales

**Date:** 2026-09-23 · **Status:** Accepted

**Context:** The organizer gives free tickets (press, guests, sponsors).
They must take real seats and reach the door list, but bring in nothing,
and promo codes deliberately never make a ticket free (ADR-027). Design
B13: a sheet with ticket type, how many, one name, email and a required
reason ("kept in the audit trail, never shown to the guest"), and the note
"creates an order at ৳0.00 with a comp flag so revenue and attendance stay
honest". ADR-026 had already said reports would need a figure of their own.

**Decision:**

- **A comp is an order.** Same table, same tickets, same door list, same
  per-ticket cancel (which is the design's "cannot be undone — only
  cancelled ticket by ticket"). `orders.complimentary_reason` is the flag
  and the reason in one column, so they can never disagree. The price is
  the ticket type's row (Invariant 5), snapshotted like any order, and the
  whole subtotal is the discount, so `computeOrderTotals` gives ৳0 — no
  new money math.
- **It lives in `fulfilment.service.ts`** (`issueComplimentaryTickets`).
  That file is the only writer of `issued`, the only caller of
  `convertToSold` and the only creator of ticket rows (Invariant 4); a comp
  does all three, so it is a second entry point into the same module, not
  a copy. One transaction: `inventory.hold` (the same atomic UPDATE every
  order takes — sold out is `SoldOutError`, nothing written) →
  `convertToSold` → the order row inserted **at `issued`** → tickets → one
  `order.comp_issued` audit row (`∅ → issued`, reason and codes in the
  note). Retried whole on a reference or ticket-code collision. The C2
  email goes after commit through the existing `onTicketsIssued` hook.
- **The state machine gains an entry, not a transition.** Rows are born at
  a status by insert, as `createOrder` has always done at
  `pending_payment`; `assertOrderTransition` governs moves between
  existing statuses and is unchanged. A comp can only be `issued` or
  `cancelled` (CHECK `orders_complimentary_status`), so the expiry job and
  the verification queue can never see one.
- **The database backs it:** `orders_complimentary_free` (a comp's
  discount is its whole subtotal, it carries no trxID and no promo code),
  `orders_complimentary_status`, and `orders_phone_unless_comp` —
  `buyer_phone` is now nullable (the design asks no phone; there is no
  bKash sender to compare), but only a comp may lack one, because Find my
  order matches reference + phone.
- **No sales-window or registration-window check.** Comps are the
  organizer's call, before registration opens or after it closes; stock is
  the only limit. Same 1–10 per order as every order; more guests means
  issuing again. The sheet opens from the event's Ticket types tab (per-row
  "Issue comps" and a header button); not from B8 in this slice.
- **Comps are seats, not sales.** They are in the inventory counters
  (Tickets sold, Seats left, the public stock, the door list) and counted
  on their own — a fifth KPI "Complimentary" and a Comp column, shown only
  when an event has comps. They are out of every figure that describes
  buyers: verified-order counts, revenue orders, the funnel, the daily and
  cumulative series, discount given, order sizes, average ticket price,
  when people register. B9's revenue tile says "N paid orders · M comp".
  `orders.totalsByStatus` returns each status's `compCount` from the same
  query, so B9 and B12 subtract from one snapshot.
- **What the guest sees:** the C2 email and the A4 order page say
  "Complimentary tickets from <organizer>, issued on …" and never "paid";
  the reason is on B8 only.
- **Audit timestamps use `clock_timestamp()`** (migration `0016`). With
  `now()`, every row one transaction writes shares the transaction's start
  time, and `listEvents` (ordered by `created_at`) could return "order
  cancelled" before the "ticket cancelled" that caused it — found as a
  flaky integration test while building this slice; it predates it.

**Consequences:** Migrations `0014`–`0016`. `FulfilmentDeps` needs
`ticketTypes`. The B12 empty state ("No sales to report yet") stays until
the first _paid_ order, even if comps exist; the KPI row and ticket-type
table still show them. The summary CSV gains a trailing `complimentary`
column and the orders CSV a `complimentary` column.

**Revisit when:** comps need to be refused for an archived or finished
event (today nothing stops it; the guest would get a "You're in" email), a
double submit must be idempotent (two tabs issue two comps), or comps need
their own list/report beyond the order list.

---

## ADR-029 — Private venue: stripped from the public read models, revealed to ticket holders

**Date:** 2026-09-23 · **Status:** Accepted

**Context:** Some events should not advertise their venue in public posts
or on the site; only people with tickets should learn it. The venue was on
every public surface (home hero and cards, event page with a Maps link,
registration, archive, the Open Graph text).

**Decision:**

- **Two event columns** (migration `0017`): `venue_hidden` (default false —
  existing events unchanged) and `venue_area`, an optional public hint
  ("Tejgaon, Dhaka"). CHECK `events_hidden_venue_set`: a private venue must
  exist, because ticket holders are promised one. The form refuses the same
  thing; the area is stored only while the venue is private.
- **Removed at the source, not at each page.** `eventsService.getPublicEvent`,
  `getHomePage` and `getArchivePage` — the only reads public pages use —
  pass every event through `forPublic` (`src/server/lib/venue.ts`), which
  sets `venue` to null when it is private. A page cannot print, link or
  serialise into the RSC payload a value it never received. `publicVenue` /
  `publicVenueLine` decide what is shown: the area plus "Exact venue is sent
  with your tickets", no Maps link (an area is the wrong door). The archive
  shows the area alone (the note is moot after the event). `seo.ts` uses
  `publicVenue` too, so share text is safe even from an unstripped event.
- **Ticket holders read the full event** through the paths that already
  gate on an issued ticket: C2 (with "please don't share it widely"), the
  web ticket page, the PDF and the calendar file. A buyer awaiting
  verification never sees it — A4 and C1 never showed the venue. Admin
  screens show it as before; the events list marks "private venue".

**Consequences:** A new public page must read through those service
methods (or call `forPublic`) — reading the repository directly would
skip the strip. Facebook keeps its cached preview until it re-scrapes a
URL. The e2e checks the raw server response of four public pages for the
venue string, which covers the inlined RSC payload.

**Revisit when:** the venue should be revealed to everyone a set time
before doors, or to buyers the moment they register.

## ADR-030 — Gate scanner (Slice A): gate passes, one atomic check-in, a self-hosted decoder

**Date:** 2026-09-24 · **Status:** Accepted, partly superseded by [ADR-034](#adr-034--gate-scanner-offline-slice-b-a-hashed-list-an-outbox-double-entries-shown-not-prevented) (a sync request may carry up to 50 offline scans) · supersedes the scanner parts of ADR-015 and ADR-023

**Context:** The organizer wants tickets scanned at the gate, from phones,
at several gates at once. Until now the rule was "no scanning — a printed
list". Every ticket's QR already encodes only its code (ADR-015), and that
code is in every PDF and email already sent, so a scanner can read the
tickets people already hold. Planned with four research agents and two
adversarial plan reviews; built in two slices — this one online, Slice B
an offline fallback.

**Decision:**

- **Gate passes, not staff accounts.** `door_passes` (migration `0018`):
  one event, one gate label, a 12-symbol code from the ticket alphabet
  (~59 bits, UNIQUE, CHECK on the format). The entropy is the defence; the
  sign-in throttle only keeps noise down, and counts only WRONG codes — door
  phones share the venue's IP with everyone there, so a stranger's guesses
  must never lock a right code out. The code is stored in **plain
  text** so the organizer can show it again to a replacement phone — it is
  shown only on the admin check-in page. A pass works from 4 h before the
  start ("practice" before that: answered and logged, never checked in)
  until 6 h after the end (with no end time the end is taken as start + 6 h,
  so start + 12 h). The window is
  **derived from the event's current dates on every request, never
  stored**, so moving the event can never strand a pass. A draft event
  refuses its passes; an archived one keeps scanning until the window ends
  (archiving promises issued tickets stay valid).
- **The credential is an httpOnly cookie scoped to `Path=/door`**,
  `SameSite=Lax` (a pass link opened from WhatsApp must carry it), `Secure`
  from the request protocol, `Max-Age` to the window's end. The pass link is
  `/door#code=…` — a fragment never reaches the server or its logs, and the
  page wipes it with `replaceState`. It is a different credential from any
  better-auth session, so a door phone can never reach `/admin`.
- **The door API is route handlers under `/door/api/*`, not Server
  Actions**: a door tab stays open all night, and action ids change on every
  deploy. Every write is a same-origin JSON POST/DELETE (content type and
  `Origin` host checked — route handlers get no built-in CSRF check).
  Responses are `no-store`; `/door/*` sends `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `Permissions-Policy: camera=(self)`.
- **One atomic check-in** — the Invariant 2 pattern: `UPDATE tickets SET
checked_in_* WHERE id AND status = 'issued' AND checked_in_at IS NULL
RETURNING`. Of any number of simultaneous scans exactly one admits; the
  rest re-read inside the same transaction and answer ALREADY IN with the
  winner's time and gate. Two CHECKs backstop it: the three `checked_in_*`
  columns are all set or all null, and a checked-in ticket must be `issued`
  (so it can never be cancelled). `cancel` requires `checked_in_at IS NULL`
  and `fulfilment.cancelTicket` refuses with "admitted 20:51 · Gate A — undo
  the check-in first".
- **Inside a scan transaction only tx-bound statements run.** The pool has
  10 connections; a pool read from inside a transaction that is waiting on
  a ticket row lock could starve it. The integration test runs 12 parallel
  scans of one ticket to prove it finishes.
- **The pass is locked, not just read.** The first statement of every scan
  (and door-undo) transaction is `SELECT … FROM door_passes WHERE id AND
revoked_at IS NULL FOR SHARE`. Scans on one pass never block each other,
  but a revoke (NO KEY UPDATE) waits for the ones in flight, so
  revoke-and-undo sees every check-in they make, and any scan after it finds
  the pass revoked (401). Lock order is pass → ticket everywhere.
- **Every undo is a compare-and-swap on one check-in** (`undoCheckIn(id,
scanId)`): the door's own admit, the one the admin's page showed, the ones
  a revoked pass made. None can clear a later, legitimate check-in; the
  admin's audit note records which check-in (time · gate) was taken back.
- **Every answered scan is logged in `door_scans`** (append-only, all foreign
  keys RESTRICT): result, method (qr/typed/search), mode
  (online/offline/practice), the earlier check-in shown on an ALREADY IN,
  the device clock (advisory) and `received_at`. Stray QR text is never
  stored — only the parsed ticket code, or `<unparsed:len=N>`. Every
  check-in and every undo also writes an `order_events` row (Invariant 6 in
  spirit; the order status does not change). Refused requests (401, 403,
  429, 400) and replays write nothing.
- **Idempotent by a phone-generated `scanId`** (UNIQUE). A retry — the Retry
  button, or re-reading the same code within 2 minutes after no answer —
  sends the same id, and the server replays the stored answer: the person
  just admitted is never turned away by their own retry. A replayed ADMIT
  is green only for the Retry button; from a fresh read it shows amber
  ("admitted N s ago — same person?"), because it could be a second person
  with a screenshot; and it replays only while that very check-in stands —
  once undone, the answer is "scan again". The same id with
  other input or from another pass answers `scan_id_conflict`; a scan
  racing its own retry loses on the UNIQUE index, rolls back and replays
  the winner.
- **Answers never carry a ticket code or buyer contact details** (a test
  asserts no `TKT-` in the JSON). A wrong-event answer names only the other
  event's title, and the gate's recent-scans list joins only this event's
  tickets. Name search (a POST, so names never sit in URLs or access logs)
  matches the name OR a code ("mahmudur" is also 8 letters of the code
  alphabet). A **search admit** is the easiest fraud: staff ask for the last
  3 digits of the phone that bought the ticket and type what they hear; the
  server checks them (`phone_mismatch` is refused and logged). The digits are
  never sent to the door phone — an impostor could read them off the screen.
  A comp has no phone to check. Search admits have their own tighter budget.
- **Logs never carry a pass or ticket code.** Drizzle's query errors end
  with the bound params; door code logs through `safeErrorShape`, which
  drops them. The cookie is `Secure` whenever SITE_URL is HTTPS (like
  better-auth's), not only when a proxy says so.
- **Rate limits fail open** (`src/lib/door-limits.ts`): a Redis blip must
  never stop a gate. Code entry 20 per 10 min per IP; scans 240/min, search
  admits 20/min and searches 60/min per pass. 429 carries `Retry-After`.
- **Undo:** the door may undo its own admit for 2 minutes with a reason from
  a short list (a mis-tap, the wrong person) — long enough to fix a slip,
  too short to recycle a ticket. The organizer can undo any check-in on the
  order page, and **Revoke and undo** a leaked pass: revoke it and take back
  every check-in it still holds, each audited.
- **Decoder:** iOS Safari has no `BarcodeDetector`, so the page uses the
  `barcode-detector` 3.2.2 ponyfill over `zxing-wasm` 3.1.3 (zxing-cpp in
  WebAssembly), pinned exactly, loaded with a dynamic import on `/door`
  only. The `.wasm` is **served from our origin**
  (`public/vendor/zxing_reader-3.1.3.wasm`), never jsDelivr; a unit test
  checks its SHA-256 against the package's `ZXING_WASM_SHA256`. A future
  Content-Security-Policy must allow `'wasm-unsafe-eval'` on `/door`.
- **The QR stays unsigned.** ADR-015 said a scanner would need a signed QR.
  Online, every scan is checked against the database and the ~40-bit codes
  are UNIQUE, so a signature adds nothing — and keeping the QR means no PDF
  or email has to be reissued. A shared screenshot is handled by
  first-scan-wins, with the attendee's name shown on ALREADY IN. The
  offline case is Slice B's problem.
- **Door phone UX:** one Start tap opens the rear camera, unlocks sound
  (`navigator.audioSession.type = 'playback'` so iPhones beep on silent; an
  `<audio>` fallback before Safari 17) and takes the wake lock; hidden page →
  everything released → "Tap to resume". About 10 decodes a second, one at a
  time, auto-pause after 2 idle minutes, and "Tap to resume" if frames stop
  for 3 s (a call banner, Siri). Sound unlocks on the first tap or key of
  any kind. Duplicate camera reads are ignored while the code stays in view
  (a code that comes back goes to the server, which answers amber at this
  gate — that is how a handed-back screenshot is caught), and while a
  full-screen panel hides the viewfinder;
  typed and handheld (keyboard-wedge, caught at the document, no hidden
  field) codes always go to the server. Full-screen answers: green ADMIT
  (clears itself), amber "admitted N s ago at this gate", red ALREADY IN /
  CANCELLED / WRONG EVENT / NOT A VALID TICKET, blue PRACTICE. In-app
  browsers (Messenger, Instagram…) get an "open in Safari or Chrome" card.
- **Admin:** the check-in page gains the gate-passes card (QR of the pass
  link, the code, tips), "N of M checked in", a Checked-in column and an
  All · In · Not yet filter that is treated like the search (Print disabled,
  "Partial list" on the sheet, carried into the CSV, whose `checked_in`
  column is now filled). The print sheet ticks people already in.

**Consequences:** The printed list is now the backup, not the process.
Tickets that are checked in cannot be cancelled until the check-in is
undone. The door needs signal; without it staff use the printed list until
Slice B. Phone testing needs HTTPS on a real host — a cloudflared quick
tunnel ([DEVELOPMENT.md](DEVELOPMENT.md)); `next dev --experimental-https`
is not enough (its certificate is for localhost only).

**Revisit when:** Slice B (offline list + outbox + sync) is planned; or a
CSP is introduced; or gates need per-staff accountability (named staff
accounts instead of a shared pass).

## ADR-031 — Help & policies (Canvas 5): content as data, repo copy wins, an accessible focus ring

**Date:** 2026-09-25 · **Status:** Accepted

**Context:** The static pages (Terms, Privacy, Refunds, FAQ, About, Contact)
were redesigned in Claude Design as Canvas 5 ("A7 evolved"): a policy
switcher, a short version, a table of contents, numbered sections with
anchors, callouts, FAQ topics, an editorial About, contact cards and an A4
print. The design was drawn from an older copy of the repo's wording.

**Decision:**

- **Policies are data** (`src/content/policies/*.tsx`): each is a purpose
  line, a short version and `{ id, title, body }` sections. The table of
  contents, the numbered sections, the anchors and the printed page come
  from one list, so they cannot drift apart. Section ids are permanent
  anchors, like the FAQ ids; FAQ items carry a topic.
- **The repo's copy wins where it is newer than the design** (the scanner
  wording of ADR-030: door staff never see the phone digits). The design's
  new summaries, callouts, About steps and FAQ wording were approved with
  the plan; a review against the code corrected the rest (sign-in stores
  the IP address and browser; the printed backup list also carries ticket
  types and order references; the emails list; a ticket the organizer
  cancels is refunded).
- **The focus ring deviates from the design:** the specified 3 px marigold
  outline is about 2:1 against these light surfaces, under WCAG 1.4.11's
  3:1, so a 2 px charcoal ring fills the outline offset. The design system
  canvas should be updated to match.
- **Print is scoped:** a named `@page help` (16/16/18 mm) and a
  `.help-page` rule (black on white, no tints, links not underlined); the
  admin print sheets keep the default page. The public header and footer
  are hidden in print everywhere.
- Three small client pieces, all progressive enhancements: a scroll-spy
  (`aria-current`), anchors that also copy their URL, and "Print or save as
  PDF". Everything works as plain links without JavaScript.

**Consequences:** A new policy section is a data entry, not markup. Any
promise added to a short version or callout must restate a section below
it. The sticky table of contents is sticky only on viewports at least
44 rem tall (short laptops would hide its last rows).

---

## ADR-032 — Home, navigation & sponsors (Canvas 6): logos through the server, one offer rule, a path-aware header

**Date:** 2026-09-25 · **Status:** Accepted · supersedes the home and header parts of ADR-020; extends ADR-031's focus ring

**Context:** Canvas 6 (Claude Design) rebuilds the home page, the header
(with a full-screen phone menu) and the footer, and adds sponsors: an admin
screen (B15), "Supported by" on the home page, a row in the footer and
"Presented by" on the event page. Sponsors did not exist in the app. The
design did not cover the event page's dark title band, a list of upcoming
shows, or the admin at phone width.

**Decision:**

- **Sponsors data** (migrations `0020`, `0021`). Enums `sponsor_level`
  (presenting → partner → supporter, also the display order) and
  `sponsor_tile_tone` (light | dark). `sponsors` has the name (also the
  logo's alt text), an optional https website, the logo key, `active`,
  `position`, and `logo_width` / `logo_height` measured on upload, which
  the tile sizing formula (`src/lib/sponsor-fit.ts`) needs. They are double
  precision (> 0) because a viewBox can be fractional. A partial unique
  index, `sponsors_one_presenting`, allows one presenting partner. Saving a
  new one moves the old one to Partner #1 in the same transaction.
  Positions stay dense (1…n per level): every write takes a
  transaction-scoped advisory lock and renumbers the level. ▲▼ and the
  number field all call one `setPosition`. There is no UNIQUE (level,
  position), because a one-statement renumber that swaps two rows would trip
  it. `events.presenting_sponsor_id` is optional, `ON DELETE SET NULL`.
- **Logos go through the server, not a presigned PUT.** This deliberately
  departs from ADR-007, which covers still follow. Logos are SVG or PNG, at
  most 512 KB, under the default 1 MB server-action body limit. The server
  needs the bytes to measure the shape, to screen SVGs, and to store the
  file with `Content-Disposition: attachment`. Opening the URL directly
  downloads the file; an `<img>` still shows it. Each upload gets a fresh
  key, `sponsors/<id>/logo-<nanoid>.<ext>`, cached as immutable.
  `ObjectStorage.put` runs before the transaction, and a replaced or
  deleted logo is removed after commit, best-effort (Invariant 7). This
  needs no CORS rule, no storage read-back and no cleanup of abandoned
  uploads.
- **`inspectLogo`** (`src/server/lib/sponsor-logo.ts`) has no imports, so
  the form runs it for an instant preview. The server runs it again as the
  authority.
  - **PNG:** a valid signature with IHDR first, not Apple's CgBI format,
    16–4096 px a side.
  - **Shape, both formats:** at most 20 times wider than tall (or taller
    than wide), and a viewBox side of at most 10⁶. The tiles size a logo by
    width ÷ height, and an absurd viewBox would overflow it. `fitLogo`
    also clamps instead of throwing, so a bad stored row can never break
    the footer on every public page.
  - **SVG, accepted form:** strict UTF-8; no SVGZ, DOCTYPE, ENTITY or
    stylesheet instruction; a root `<svg>` with the SVG xmlns and a valid
    viewBox, which gives the shape.
  - **SVG, refused content:** SVG elements come from an allowlist. Script,
    foreignObject, `a`, animation elements and the XHTML and MathML
    namespaces are refused under any prefix, and so are `on*` attributes.
    Links may only be `#…` or `data:image/…;base64`, checked after decoding
    references. Styles may not use `@import`, `image-set()` or an external
    `url(`. That applies to `<style>`, `style=""` and every unprefixed
    presentation attribute (`mask`, `cursor`, `fill`…). A backslash
    anywhere in that CSS is refused, and the checks run on the text with
    and without comments, because escapes, strings and comments can hide a
    load from a simple scan. Prefixed editor metadata stays free text.

  Logos are only ever drawn with `<img>`, so the screen is defence in
  depth: a file it cannot classify is refused.

- **One offer rule for the home page and the event page**
  (`offerSummary`, `src/server/lib/event-offer.ts`).
  - **An Early Bird is recognised by shape:** its sales end before
    registration closes, and it is cheaper than the cheapest type that
    sells until the close.
  - **The "from" price** counts only types still sellable (window not
    ended, not sold out); if none are, it counts every type.
  - The same result picks the event page's highlighted row and the
    "Early Bird on sale" chip. `availableTotal` is unchanged.
- **The hero skips a show whose registration has closed** while another
  upcoming show exists (`selectHomeEvents`). This covers only closed
  shows: a sold-out or not-yet-open main show still drops the header's
  "Get tickets" (N3 follows the main show). Then the phone menu points to
  `/events` instead of saying nothing is on sale. The closed show moves to "Also upcoming" with the chip
  "Registration closed". A new `/events` page lists every upcoming show in
  the `/archive` layout, and the "Events" nav link goes there. Under the
  hero the home page shows up to three more upcoming shows, with "All
  upcoming events (n) →" when there are more, then six past shows on
  phones or four on desktop.
- **Chrome.** The dark header is used on `/` only. Three small client
  pieces read the path: `HeaderFrame` sets the tone, `SiteNavLinks` sets
  `aria-current`, and the phone menu closes when the path changes. The rest is server-rendered. The phone menu is a full
  screen on `@base-ui/react/dialog` (focus trap, Esc, focus return). It
  closes on navigation and at `lg`, and it replaces the shadcn Sheet. The
  footer navs (Tickets, About, Help) are named by their headings, and Legal
  by its label. ADR-031's focus ring now also covers `.site-chrome` and
  `.home-page`. The active link's underline is a pseudo-element, so the
  ring's box-shadow cannot erase it.
- **Chip vocabulary, sitewide** (`phaseChipLabel`): On sale · Early Bird
  on sale · Closing soon · Not on sale yet (hero) or On sale 25 Oct
  (cards) · Sold out · Registration closed · Past.
- **Adapted where the design was silent** (approved with the plan):
  "Presented by" has a dark-band variant for the event page's dark title
  band. `/events` reuses the `/archive` layout. On phones the B15 rows
  become stacked cards and the preview sits under the form. The event form
  gains a "Presenting sponsor" select, which marks hidden sponsors.
- **Repo over design:**
  - 24-hour Dhaka times;
  - "N days before the show" is computed;
  - covers stay plain `<img>`, with `fetchPriority="high"` on the hero
    (replaced by ADR-033: covers now go through `next/image`);
  - segmented controls stay radio inputs, now one shared component;
  - sponsor links carry `rel="sponsored noopener"`.

  Dropped: the drag handle (there is no drag-and-drop; ▲▼ and a number
  instead) and the grayscale "mono" logo option.

**Consequences:**

- A public page that shows sponsors reads `getPublicSponsors()`: active
  sponsors only, React-cached per request.
- A sponsor write revalidates the whole public layout, because the footer
  is on every page.
- Deleting a sponsor quietly clears "Presented by" on its events.
- Some real exports must be exported again: SVGs with a DOCTYPE (Affinity,
  CorelDRAW, older Illustrator "SVG 1.1"), Figma's background blur (a
  foreignObject), and fonts embedded in styles.
- Known follow-up: unsold stock of a type whose sales window has ended
  still counts as "left" in the four places that sum `availableTotal`: the
  home read model, the event page, the registration page and order
  creation.

**Revisit when:** a sponsor needs a separate logo for dark tiles, or
ordering by drag; the organizer wants DOCTYPE exports accepted; or
`availableTotal` should respect sales windows.

---

## ADR-033 — Event covers through `next/image`: the allow-list from `R2_PUBLIC_URL`, sized per placement

**Date:** 2026-09-26 · **Status:** Accepted · revisits ADR-007's "no image processing"; replaces ADR-032's "covers stay plain `<img>`"

**Context:** Covers are stored as uploaded, up to 5 MB, with no resizing
(ADR-007). Nine places drew them with a plain `<img>`, so a phone downloaded
the full file for a 240px card, and the event page fetched it twice. The only
reason for `<img>` was that the storage host is env-defined, and next/image
needs it allow-listed.

**Decision:**

- **Every event cover renders through `next/image`.** That covers the hero, the
  dormant hero, event cards, the past strip, the archive, the event page, the
  About band, and the two admin previews. Each has `width={1200}
height={630}` and a `sizes` taken from its layout (the constants sit beside
  the components). The browser gets a WebP at the width it needs from Next's
  optimizer (`/_next/image`), and pages keep their classes and boxes.
- **The allow-list is built from `R2_PUBLIC_URL` at build time**
  (`coverImagesConfig`, `src/lib/image-config.ts`). It is one pattern: the
  scheme, host and port of that URL, the path `<base>/**`, and no query string.
  The optimizer is a server-side fetcher anyone can point at a URL, so it may
  fetch from the storage bucket and nowhere else. An e2e test pins the 400s
  for another host and for another path on the storage host.
- **Local IPs only for loopback storage.** Next 16 refuses upstream images
  that resolve to private addresses (`dangerouslyAllowLocalIP`). It is on only
  when `R2_PUBLIC_URL`'s host is `localhost`, `127.x` or `[::1]` (MinIO in dev
  and e2e). The URL decides, not `APP_ENV`, so a build pointed at R2 can never
  fetch a private address.
- **Unset `R2_PUBLIC_URL`:** no host is allowed and the build warns (CI's
  `pnpm verify` has no storage env). A `staging` or `production` build
  fails instead of shipping a site whose every cover is broken.
- **Cache:** `minimumCacheTTL` is 31 days. This is safe because every upload
  gets a new key (`cover-<nanoid>`), so a URL's bytes never change and a
  replaced cover is a new URL. `deviceSizes` are the defaults without 3840.
  Formats stay WebP only, because AVIF encodes several times slower on the
  first request.
- **Priority:** the covers that are the largest paint (the hero, the dormant
  hero, and both event-page covers) are `loading="eager"` with
  `fetchPriority="high"`, as before. We don't use `preload`: these images are
  already in the server HTML, which is the case Next 16's docs point to eager
  loading for. The event page's phone band and desktop backdrop share
  `sizes="100vw"`, so they share a srcset, and the browser fetches one file
  for both.
- **Stays raw:**
  - Open Graph and share metadata use the storage URL, because crawlers need a
    stable, absolute 1200×630 image.
  - Sponsor logos stay `<img>`. They are small, often SVG (which the
    optimizer refuses without `dangerouslyAllowSVG`), drawn at exact fitted
    sizes, and served as attachments.
- **`sharp`** moves from devDependencies to dependencies, pinned at 0.35.4,
  so a production install always has it (Next also lists it as optional).
  sharp 0.35 ships prebuilt `@img/sharp-*` binaries and has no install
  script, so `pnpm-workspace.yaml` keeps `sharp: false`.

**Consequences:**

- `R2_PUBLIC_URL` is now also a **build-time** variable. Moving the bucket or
  domain means a rebuild.
- The first request for each cover width costs CPU on the app server (sharp
  decodes up to 5 MB). Later requests come from the disk cache in
  `.next-build/cache/images`, because `distDir` is `.next-build`. Deployment
  must keep that folder between releases, or every cover is re-encoded after
  each deploy.
- Tests that pinned a cover `src` now read the storage URL from the
  optimizer's `url=` parameter (`tests/unit/helpers/next-image.ts`).

**Revisit when:** the app runs behind a CDN that can resize (then use a custom
loader), or the server's CPU becomes the bottleneck on a show's launch day.

---

## ADR-034 — Gate scanner offline (Slice B): a hashed list, an outbox, double entries shown not prevented

**Date:** 2026-09-26 · **Status:** Accepted · extends [ADR-030](#adr-030--gate-scanner-slice-a-gate-passes-one-atomic-check-in-a-self-hosted-decoder)

**Context:** Venue signal fails exactly when a queue forms. In Slice A a scan
with no answer said NOT RECORDED and staff fell back to the printed list.
The door phone should keep answering, and the server should still end up
knowing who came in, where and when.

**Decision:**

- **The offline list.** `GET /door/api/list` gives the pass's event: every
  ticket's attendee name, ticket type, "N of M", status and check-in
  (time · gate). Nothing about the buyer is included, not even the phone
  digits. A ticket code goes out only as `SHA-256(salt:code)` cut to 128
  bits, with a fresh random salt per download. The phone fetches it at
  sign-in and every 60 s, and keeps it in IndexedDB (memory if IndexedDB
  is unavailable).
  - **What the hash is worth.** Codes carry about 40 bits, so anyone
    holding the list could grind through them. The hash only keeps codes
    from being read straight off a door phone. The printed backup list
    already prints them in full. A slow hash was rejected: it costs real
    server CPU every minute per gate and still falls in hours on a GPU.
  - **Where the logic lives.** `src/server/lib/door-offline.ts` is pure
    and uses WebCrypto (`crypto.subtle`, identical in Node and the
    browser), so the server and the phone hash and judge with the same
    file.
- **The offline answer.** When a scan gets no answer, the phone:
  1. judges it from the list (`judgeOffline`): admit, already in (from
     the list or from this phone since), cancelled, not on this list, or
     practice before doors open;
  2. shows that answer marked "offline";
  3. queues the scan in an outbox under a new `scanId`, with
     `supersedesScanId` set to the unanswered request.

  From then on scans skip the network until a status ping succeeds.
  - **"Not on this list" replaces "wrong event"** offline, because another
    event's ticket cannot be told apart from a made-up code.
  - **The phone's clock** is corrected by the offset it measures against
    the server's (list download and every status ping).

- **Sync.** The outbox is sent oldest first, 50 per request, to the same
  `POST /door/api/scans`. Only offline scans may be batched, and they have
  their own rate limit (30 requests a minute per pass), so emptying an hour
  of backlog never starves live scans. Each scan carries `door_verdict`,
  what the door showed:
  - **`admitted`:** the server replays it as a real check-in, with the
    same conditional UPDATE and pass lock as ADR-030. It is dated at the
    corrected phone time, clamped to `[doors open, now]`, and audited with
    "· offline".
  - **`refused` / `practice` / `undone`:** logged only; nothing is checked
    in, because nobody walked in. A ticket the server would have admitted
    is logged as the new result `turned_away`.
  - **Idempotency:** a re-sent sync replays by `scanId`, as ADR-030 does.
- **Double entries are shown, not prevented.** Two gates without signal
  cannot know about each other, so both may admit one screenshot. A double
  entry is an offline scan where `door_verdict = admitted` and the server's
  result is not `admitted`.
  - It is **not** a double entry when the online request it replaced
    itself admitted: that was the same person, and only the answer was
    lost (`supersedes_scan_id`).
  - The admit is recorded, never trusted. The check-in page lists double
    entries with both gates and times and a link to the order, and each
    gate pass shows its offline scan count.
- **Name-search admits need signal.** The buying phone's digits never
  reach the door, so offline the name search shows who someone is and
  whether they are in, but cannot admit.
- **The door's own undo** of an admit that has not been sent yet changes
  its verdict to `undone`. Once sent, the online undo applies, with its
  2-minute window counted from when the door admitted, not from the sync.
- **Session end.** End session tries to send the outbox first and warns
  when scans remain. A 401 (pass revoked, or its window over) wipes the
  list and outbox and says how many scans never reached the server.
  Outbox scans of another pass are dropped with a notice: sent under a new
  pass, their gate label would be wrong in the record.
- **Schema:** migration `0022` adds `door_scans.door_verdict` (with a CHECK:
  set exactly when `mode = 'offline'`), `supersedes_scan_id`, and a partial
  index on offline scans. Migration `0023` adds the `turned_away` result.
  The recent-scans list is ordered by when a scan happened (the phone's
  time for an offline scan), not when it arrived.

**Consequences:**

- **First-scan-wins still holds while a gate has signal.** Offline, it
  becomes "last-to-sync is flagged". The terms and privacy pages now say so.
- **Every door phone holds the event's attendee names** for the night. The
  printed list already did; they are wiped when the session ends.
- **The list is re-sent in full every minute:** about 150 bytes a ticket,
  roughly 150 KB for 1,000 tickets. That is acceptable for one event, and
  an ETag or delta can come later.
- **A reload with no signal still fails.** There is no service worker
  yet, so the tab must stay open. That is Slice B2.

**Review fixes (2026-09-26):**

- **The stored time of an offline scan is the clamped one**, not the phone's
  raw clock. A future-dated admit could otherwise hold the door's 2-minute
  undo open indefinitely.
- **A scan the phone has sent is never undone locally again**, even when the
  send got no answer: its ADMIT may already stand, and a re-send as
  `undone` under the same `scanId` cannot take it back. The server checks
  this too: a replay whose `door_verdict` differs from the stored one
  answers `scan_id_conflict`, not the stored ADMIT.
- **A phone's own "already in" mark is dropped only by a list read after
  the server is known to have had it** (sync confirmed, plus 15 s for clock
  correction). It is never dropped by when the person walked in. The list's
  "as of" is taken before its database read.
- **`sync()` waits for a send already in flight** instead of skipping it.
  Otherwise End session could sign out under that send, and its scans
  would come back 401 and be lost.

**Revisit when:** Slice B2 (a service worker so `/door` loads offline —
done, [ADR-035](#adr-035--gate-scanner-slice-b2-a-service-worker-so-door-reloads-without-signal)); an
event large enough that the per-minute list matters; or the organizer
wants double entries to alert someone live.

## ADR-035 — Gate scanner Slice B2: a service worker so /door reloads without signal

**Date:** 2026-09-26 · **Status:** Accepted · extends [ADR-034](#adr-034--gate-scanner-offline-slice-b-a-hashed-list-an-outbox-double-entries-shown-not-prevented)

**Context:** After Slice B the ticket list and the outbox survive on the
phone, but the page does not. iOS drops background tabs, and staff pull to
refresh. A reload without signal then left the gate with no page at all.

**Decision:**

- **One worker, for `/door` only.** `public/door/sw.js`, bundled by
  esbuild from `src/app/door/offline/sw.ts` (`pnpm sw:build`, run first
  by `pnpm build`; git-ignored). It is registered with scope `/door`, one
  level above its own folder, which the script allows with
  `Service-Worker-Allowed: /door`. It is served `no-cache`, so a fix
  reaches phones on their next load, and it takes over at once
  (`skipWaiting` + `clients.claim`). The rest of the site has no worker.
- **What it answers.** Opening `/door` is network first. Past 5 s, with
  no network at all, or on a 5xx, it opens the saved copy. With no copy
  it shows a self-contained "No signal" page that points to the printed
  list. `/_next/static/*` and `/vendor/*` are content-named, so they are
  cache first and saved as they load. Everything else goes to the network
  untouched: the door API, the RSC refresh of `/door`, other pages and
  other origins. Answers about a ticket come only from the server or from
  the ADR-034 list, never from a stale HTTP response.
- **The page saves itself; the worker never saves a page.** A page's
  first load is not controlled by a worker, and a worker cannot tell a
  signed-in page from a signed-out one. So once a status ping gets
  through, the scanner warms the decoder (the saved copy must be able to
  start the camera). It then fetches a fresh `/door` and saves it, plus
  every build file this load used (from Resource Timing), and deletes
  files that only an older build used.
- **Deleted when the session ends.** The saved page lists the gate's last
  scans, with names. End session, a 401, and a page the server renders
  signed out all delete it. A generation counter keeps a save still in
  flight from bringing it back. The privacy policy's door-phone row says
  so.
- **The saved copy opens offline.** A scanner whose first status ping
  gets no answer starts in offline mode, which is most likely the saved
  copy. The first person in the queue does not wait out a request that
  cannot answer. The banner adds "Counts as of HH:MM", because the header
  counts come from the load that was saved.
- **Production only.** In `next dev` file names change on every edit, and
  a worker would serve old code.

**Consequences:**

- A phone must open its pass once with signal. A phone that never did
  gets the "No signal" page.
- A page load on weak signal can take up to 5 s longer than before
  (then the copy opens), and the copy's header counts and last scans are
  from its save. The first status ping that gets through replaces them.
- Every scanner load costs one extra `/door` render (the save) and warms
  the decoder, about 1 MB of wasm that the browser caches for a year.
- A buggy worker could stick to phones. Mitigations: `no-cache` on the
  script, scope limited to `/door`, and a recovery step in DEVELOPMENT.md
  (clear the site's data).
- A future Content-Security-Policy needs `worker-src 'self'`.

**Revisit when:** the door is installed as a PWA (a manifest, a home-screen
icon); the site gets a CSP; or a phone has to start a session offline
(it cannot, since the pass cookie is set by the server).

## ADR-036 — Deployment: Dokploy on one VPS, images built in CI, pull-only deploys

**Date:** 2026-09-27 · **Status:** Accepted

**Context:** Production is one BengalCloud VPS: 2 vCPU, 4 GB RAM, 25 GB
NVMe, on a BDIX line in Dhaka. The person running it is new to server
work and wants a dashboard for logs, restarts, environment variables and
backups, not only a shell. A Next.js build needs more RAM and disk than
this server should spare while it is serving a sale.

**Decision:**

- **Dokploy** runs the app: a dashboard, Traefik for routing and HTTPS,
  managed Postgres and Redis with scheduled backups to S3-compatible
  storage (R2). Coolify does the same with a heavier footprint; plain
  Compose would leave backups, logs and rollbacks to scripts and SSH.
- **Images are built in GitHub Actions, never on the server.** One
  `Dockerfile`, two targets:
  - `web`: Next's standalone server. It runs as a non-root user, with a
    volume for the image optimizer's cache.
  - `worker`: the BullMQ worker, plus the bundled ops scripts `migrate`,
    `create-admin` and `promote-admin`.

  Standalone output is enabled only by the Dockerfile (`NEXT_OUTPUT`).
  `pnpm start` and Playwright keep `next start`.

- **The deploy chain:** CI passes on a push to `main`, then
  `deploy.yml` builds both images and smoke-tests them against a real
  Postgres and Redis. The smoke test runs every migration from empty,
  checks `/api/health`, `/` and `/door/sw.js`, and checks that the worker
  stays up. The workflow then pushes the images to GHCR as `main` and
  `sha-<commit>`, and calls Dokploy's API. Dokploy pulls the images and
  runs `docker-compose.prod.yml`.
- **Migrations run as a one-shot `migrate` service** from the worker
  image, using drizzle-orm's migrator (production has no drizzle-kit).
  `web` and `worker` start only if it exits 0.
- **Rollback is pinning `IMAGE_TAG=sha-…`** in Dokploy. Migrations are
  never rolled back, so they must stay backward compatible for one
  release: add first, remove later.
- **`/api/health`** reports whether Postgres and Redis answer (200 or 503,
  booleans only), for the uptime monitor. `?live` only proves the process
  answers, and is the container health check. An unhealthy container is
  dropped by Traefik, so a Redis outage must not take down pages that
  could still be served.
- **Secrets per service.** Only the worker gets the SES keys, because the
  web never sends email. Both get the auth settings: the worker runs the
  `create-admin` script, and it already holds the database password, which
  is full control, so withholding the auth secret would protect nothing.
  Every secret is set in Dokploy and kept in Bitwarden, and none is in the
  repo or GitHub. The one value baked into
  the image is `R2_PUBLIC_URL`, which is public (ADR-033).
- **The 25 GB disk.** Container logs are capped at 3 × 10 MB per service,
  images come in pre-built, and old images are pruned (Slice D2).
  Memory limits keep the app from starving Dokploy: web 1 GB, worker
  768 MB. The worker idles at about 300 MB and a ticket PDF render comes
  on top of that; the web idles at about 135 MB (both measured locally).

**Consequences:**

- There is no staging server. The CI smoke test boots the exact
  production images instead, and bigger changes get checked locally with
  the same images (DEPLOY.md).
- A deploy restarts `web`, a few seconds of downtime. That's acceptable
  for one organizer; deploys avoid sale peaks and event nights. It stays
  a few seconds only because the image's health check uses
  `--start-interval=2s`: Traefik routes nothing to a container until it
  reports healthy, and without that the first check waits the full 30 s
  interval.
- The worker image is about 1 GB, because it carries every production
  dependency (Next, the editor, the shadcn CLI) though it needs a few. The
  web image is about 350 MB. Each version kept for a rollback costs that
  much disk.
- The images may be public on GHCR, like the repo. That is safe: no
  secret is in them, and the build fails if a build-time placeholder
  leaks into the output. If they are private, Dokploy pulls them with a
  GitHub token that can only read packages (DEPLOY.md).
- A manual run of the Deploy workflow works only from `main`.
- GHCR and SES are reached over the VPS's international route, so image
  pulls are only as fast as that route.
- `main` can be merged before the server exists: without `R2_PUBLIC_URL`
  (a repo variable) the Deploy workflow skips, and without the Dokploy
  secrets it pushes images but doesn't deploy.

**Found after the first real sales (2026-09-28):** the smoke test boots
the images on an empty database, so it never renders a ticket. The
worker image lacked the PDF fonts (the web image gets them through Next's
file tracing; the worker bundle has none), and a Dokploy Environment still
held placeholder SES keys; both surfaced only at the first real email.
The worker now checks both at boot (fonts readable, SES keys shaped like
keys) and refuses to start otherwise, so the smoke test's "worker stays
up" catches them, and the smoke test uses AWS's documented example keys.

**Revisit when:** the disk or RAM becomes the limit (a bigger plan comes
before any architecture change; trimming the worker image to what it
imports is the first step); zero-downtime deploys matter (two `web`
replicas behind Traefik); or a second organizer or tenant appears.

## ADR-037 — The visitor's IP behind Cloudflare: read X-Forwarded-For from the right

**Date:** 2026-09-28 · **Status:** Accepted

**Context:** The rate limits key on the caller's IP: find-order,
buyer sign-in, the promo check, the door-pass sign-in, and better-auth's
own limiter on `/admin/login`. In production a request goes visitor →
Cloudflare → Traefik → app, and each proxy appends the address it
received the request from to `X-Forwarded-For`. A test container
(`traefik/whoami`) on the live domain showed exactly what the app
receives (2026-09-28):

| Request                                 | `X-Forwarded-For` at the app             |
| --------------------------------------- | ---------------------------------------- |
| Normal, through Cloudflare              | `<visitor>, <Cloudflare edge>`           |
| Through Cloudflare, visitor sent a fake | `1.2.3.4, <visitor>, <Cloudflare edge>`  |
| Skipping Cloudflare, with fakes         | `<sender>` (Traefik replaced the header) |

The first case needed Traefik to trust Cloudflare's ranges
(`forwardedHeaders.trustedIPs`, docs/infra/SERVER.md § 13); without it,
Traefik replaces the header and every visitor looks like Cloudflare.

Two bugs remained. `requestIp()` took the **first** entry, which the
visitor controls: one fake per request dodges every limit. And
better-auth, by default, refuses a header with more than one entry: it
found no IP at all and put `/admin/login` in one bucket for the whole
internet, so anyone could keep the admin login locked.
`CF-Connecting-IP` is no answer on its own: a request that skips
Cloudflare can set it freely (the test passed a fake straight through).

**Decision:**

- One rule in both places: walk `X-Forwarded-For` **from the right**,
  skip every address inside Cloudflare's published ranges, and take the
  first one that isn't. That is the address Cloudflare itself saw.
  Anything further left is the visitor's own text and is never read.
- `src/lib/client-ip.ts` holds `CLOUDFLARE_RANGES` and
  `clientIpFromForwardedFor()`; `requestIp()` uses it; better-auth gets
  the same list as `advanced.ipAddress.trustedProxies` (its own
  implementation of the same walk).
- Range matching uses Node's `net.BlockList`: no dependency, no
  hand-written address arithmetic.
- IPv6 visitors are keyed by their /64 (better-auth does the same): a
  home or phone connection gets a whole /64, so per-address keys would
  let one device rotate past every limit.
- No usable address (no header, garbage where the visitor should be,
  only Cloudflare addresses) → `'unknown'`, one shared bucket, as before.
  `X-Real-Ip` is not a fallback: Traefik sets it to Cloudflare's edge.

**Consequences:**

- A visitor can't fake their way past a rate limit, through Cloudflare
  or around it. Around it, Traefik discards their header.
- **Cloudflare's ranges live in two places**: `CLOUDFLARE_RANGES` in the
  code and `trustedIPs` in the server's `traefik.yml`. They must change
  together. Cloudflare changes them rarely, with notice. Compare with
  https://www.cloudflare.com/ips/ once a year (with the Dokploy API key
  renewal) and when Cloudflare announces a change.
- If Cloudflare adds a range before we do, visitors arriving through it
  are keyed by that edge address (shared buckets, too strict), never a
  bypass.
- A Cloudflare Worker could send its own `X-Forwarded-For` from inside
  Cloudflare's ranges. That is throttling evasion by someone who controls
  code on Cloudflare's network, accepted: the limits are not a security
  boundary (`request-ip.ts` says so).
- Local dev and e2e have no proxy: every request shares one bucket, as
  before.

**Revisit when:** the site stops being behind Cloudflare (the ranges and
this rule go with it), or a second proxy is added in front of Traefik.

## ADR-038 — Admin accounts: change password, forgot password, change email

**Date:** 2026-09-28 · **Status:** Accepted, partly superseded by [ADR-048](#adr-048--bot-check-cloudflare-turnstile-on-the-public-forms) (`/request-password-reset` is disabled over HTTP, so its better-auth rate rule is gone; the server action's own limits stay)

**Context:** Until now an admin password could only be reset "from the
server", and an admin could neither change their password nor move the
account to another address. The organizer (Raj) gets an account with a
password chosen for him and must be able to change it himself, recover
it if forgotten, and move the account if his email is ever compromised.
Buyers have no password (they sign in by magic link) and must not get one.

**Decision:** Use better-auth's own flows; add pages, rules and emails
around them.

- **`/admin/account`** (in the admin menu as "Your account"):
  - _Password_: current, new (at least 12), again. `changePassword` with
    `revokeOtherSessions`. better-auth replaces this browser's session
    too, and the new cookie counts from the next request, so the action
    redirects (`?password=changed`) rather than re-rendering.
  - _Email_: new address plus the current password (`verifyPassword`, so
    an unlocked computer is not enough), then `changeEmail`, which emails
    a link to the **new** address. Nothing changes until it is clicked.
    At the same moment a **notice goes to the current address**, before
    anything changes, so a stranger's attempt is seen in time. On the
    click, `afterEmailVerification` deletes every session of the account,
    including the one better-auth just gave the clicking browser: the
    owner signs in again with the new address.
- **Forgot password** (`/admin/forgot-password` → email → the link →
  `/admin/reset-password`): `requestPasswordReset` / `resetPassword`,
  links valid 1 hour and used once, `revokeSessionsOnPasswordReset`.
  The answer is the same whether or not the address exists.
  `sendResetPassword` sends **only for admins**; for a buyer it does
  nothing (a password would be a second way into a buyer account).
- **Rules:** a new password is 12 to 128 characters and differs from the
  current one. `minPasswordLength` applies to new passwords only;
  sign-in still accepts an older 8-character password, so nobody is
  locked out. `create-admin` enforces 12 too.
- **Closing side doors:** `/change-email` is in better-auth's
  `disabledPaths`, so over HTTP it answers 404 and the password-checked
  page is the only way. `/request-password-reset` gets a better-auth
  rate rule (3 per 15 min); the pages have their own limits too, because
  `auth.api` calls skip better-auth's limiter. The proxy lets a
  signed-out visitor reach only `/admin/login`, `/admin/forgot-password`
  and `/admin/reset-password`.
- **Emails** (reset link, confirm new address, change notice) go
  through the queue as one job, `auth.account`, with a discriminated
  payload the worker parses again. Like the sign-in link, a job carrying
  a link is dropped once sent.

**Found while building it:** since ADR-036 the rate limiter connected to
Redis on its first request, with the producer's fail-fast client, which
refuses commands until connected. So the first rate-limited request
after every start was refused ("Too many attempts"). The limiter now
has its own connection role that waits for the connection, with a
2-second cap per count (`withTimeout`). An integration test on a real
Redis shows both the fix and the old failure.

**Consequences:**

- While SES is in the sandbox, these emails reach only verified
  addresses (the domain, the organizer's Gmail, the developer's Gmail).
  Changing an admin email to an unverified address sends nothing until
  production access (docs/infra/AWS.md).
- A lost inbox plus a forgotten password still needs the server
  (`create-admin` a new account, or a database fix). Two admins who can
  each reset the other is the practical answer.
- No audit rows: `order_events` is for orders. Changes are logged with
  the admin's email, and the notice email is the owner's record of an
  email change.

**Revisit when:** a third admin appears (then roles and an admin list),
or 2FA for admins is wanted (better-auth has a plugin).

---

## ADR-039 — SES feedback: SNS on the identity, not a configuration set; VDM and Auto Validation off

**Date:** 2026-09-28 · **Status:** Accepted

**Context:** SES production access was denied on 2026-09-21. One likely
reason: the request said bounce and complaint notifications "will be
added". Before reopening it, SES has to tell someone about every bounce
and complaint. The account also still had two billed features the setup
wizard had switched on: Virtual Deliverability Manager and Auto Validation.

**Decision:**

- **Notifications on the identity.** `echoandaura.com` sends Bounce and
  Complaint notifications (with the original headers) to a Standard SNS
  topic `ses-feedback` in `ap-south-1`. The topic has one email
  subscription, the developer's Gmail. Delivery notifications stay off,
  and email feedback forwarding is off because SNS carries both kinds.
- **Not a configuration set with an event destination.** We run without
  configuration sets on purpose (AWS.md): the worker policy is
  `identity/*` only, and a missing default set once broke every send.
  Identity notifications need neither, so the worker's policy and the
  mailer stay as they are.
- **The topic policy is scoped.** It has one statement:
  `ses.amazonaws.com` may publish only when `AWS:SourceAccount` is ours
  and `AWS:SourceArn` is the domain identity. Without those conditions,
  any SES identity in any account could publish to the topic.
- **No KMS on the topic.** The AWS-managed SNS key cannot grant SES
  access, and a customer-managed key (~$1/month) would trip the
  zero-spend budget. The message is emailed in plain text anyway.
- **VDM off, Auto Validation off.** Both are billed per message. Auto
  Validation also silently drops mail to addresses SES scores as risky.
  For a ticket email the buyer is waiting on, silence is the worst
  outcome, and without a configuration set nothing would tell us. The
  account-level suppression list (BOUNCE + COMPLAINT) stays on.

**Consequences:**

- A bounce reaches the developer as a raw JSON email within about a
  minute. What to do with each kind is in AWS.md, § Bounce and complaint
  notifications. The app does not consume these notifications: an
  order's email status still only knows "SES accepted it".
- If the topic or its policy breaks, SES switches forwarding back on by
  itself. `pnpm infra:check` checks all three settings and fails if
  forwarding is back on, VDM or Auto Validation is on, or the topic has
  no confirmed subscriber.
- Cost: $0 at this volume. The first 1,000 SNS email notifications each
  month are free.

**Revisit when:** bounces become frequent enough that someone reads
JSON emails daily. At that point, subscribe an HTTPS endpoint or an SQS
queue and let the app mark the order's email as bounced.

---

## ADR-040 — Monitoring: an outside check, one alert group, a worker heartbeat

**Date:** 2026-09-28 · **Status:** Accepted

**Context:** Before the first event, a failure had to reach a person
without anyone watching a dashboard. Two gaps stood out:

- Nothing outside the server checked it. A check running on the server
  can't report that the server itself is down.
- `/api/health` checked Postgres and Redis but **not the worker**. With
  the worker dead, the site looked healthy while no email was sent and no
  lapsed hold was released.

**Decision:**

- **Better Stack's free plan** checks `/api/health` and the Dokploy
  dashboard every 3 minutes from four regions, and alerts by email.
  UptimeRobot's free plan describes itself as for hobby and non-profit
  use, and neither free plan can post to Telegram. Paying (about $7 a
  month) buys faster checks and Telegram, and can come later.
- **One Telegram group for everything else**, plus email:
  - Dokploy's own notifications: deploy, build error, database backup,
    restart.
  - An hourly systemd timer on the server for the disk (above 80 %,
    at most one message a day, one on recovery). Its files are in the
    repo (`ops/server/`), installed by hand.

  Dokploy's email goes through the developer's Gmail (SMTP with an app
  password), **not SES**, so alerts still arrive when SES is the thing
  that broke.

- **Worker heartbeat.**
  - The worker writes the time to Redis (`echoandaura:worker:heartbeat`)
    when it starts and at the start of every `expire-holds` run, once a
    minute, before the database work.
  - The health check reads it through its probe connection. It reports
    `worker: false`, and `ok: false`, when the heartbeat is more than
    3 minutes old (three missed runs), missing, or not a number.
  - The key expires on its own at 6 minutes.
  - Writing in the job, not on a timer, proves that scheduled jobs are
    picked up, not only that the process exists.
  - Writing at boot makes the health check green within seconds of a
    deploy, so the deploy smoke test, which retries `/api/health` for up
    to a minute, needs no change.

**Consequences:**

- A dead or stuck worker now pages someone: `/api/health` answers 503.
  The container health check stays on `?live`, so Traefik never drops a
  web container because of the worker.
- Worst-case detection is about 4 minutes (a 3-minute check plus 1-minute
  confirmation). A deploy restarts the worker in seconds, well inside
  the 3-minute allowance.
- No CPU or memory alert yet: Dokploy's thresholds need its monitoring
  agent, which costs RAM on a 4 GB server. No certificate or domain
  expiry check either: RUNBOOK.md lists the dates instead.

**Revisit when:** Telegram is wanted for outages too (a paid monitor), or
the server grows enough to run Dokploy's monitoring agent.

---

## ADR-041 — The repository: public and proprietary, merge commits, versions as milestones

**Date:** 2026-09-29 · **Status:** Accepted

**Context:** The repository had drifted from the project:

- no description, license or security policy;
- Dependabot off;
- every merge method allowed;
- a changelog frozen at Phase 0, and a rule to "tag each deploy" that was
  never followed.

Before launch it needed the setup a business's code should have, and
rules that match how the project actually ships.

**Decision:**

- **Public, proprietary.** The repo stays public. On GitHub's free plan
  that is what keeps the "main is production" ruleset, secret-scanning
  push protection and CodeQL enforced, and lets the server pull images
  anonymously. The code is licensed **all rights reserved**: readable,
  not reusable. The copyright holder is the client (Echo & Aura); the
  exact legal name is still to be confirmed with Raj. `SECURITY.md` asks
  for private reports (GitHub advisories or email).
- **One merge method: merge commits,** as the history already is.
  Branches are deleted after merge. The ruleset also requires review
  threads to be resolved.
- **Versions are milestones, not deploys.** Every merge to `main` still
  deploys (ADR-036).
  - A SemVer tag (`v1.0.0` at go-live) runs the Release workflow. It
    re-tags that commit's existing images with the version, without
    rebuilding, so a rollback can pin `IMAGE_TAG=v1.0.0`. It also
    publishes a GitHub Release with notes generated from the merged PRs,
    grouped by label.
  - `CHANGELOG.md` gets an entry per version, written for the organizer.
  - No retroactive tags for the build phases.
- **Dependabot** opens one grouped PR a week for minor and patch bumps
  (npm, Actions, Docker), one PR per major bump, and security fixes as
  they come. Pins stay exact.
- **Contribution scaffolding** sized for one maintainer: `CODEOWNERS`, a
  PR template carrying the invariants checklist, and bug and feature
  issue forms. Blank issues are off, and buyers are pointed to the
  organizer.

**Consequences:** anyone can read the code and the infrastructure notes.
No secret is in them: a PreToolUse hook blocks the project's real secret
formats, and GitHub's push protection is a second lock. A tag must point
at a commit `main` has already built, or the Release workflow fails; it
never builds an image of its own.

**Revisit when:** the code should no longer be readable (then a paid plan
keeps the ruleset, and the server needs a GHCR pull token), or a second
maintainer joins (then required reviews and code-owner review).

---

## ADR-042 — Discoverability: structured data, sitemap, robots, a generated share image

**Date:** 2026-09-29 · **Status:** Accepted

**Context:** Every public page had a title, a description, a canonical
link and Open Graph tags (ADR-009), and private pages were `noindex`.
What was missing:

- nothing told search engines or AI assistants the facts of an event
  (when, where, how much, whether it is still on sale);
- no sitemap;
- `robots.txt` was Cloudflare's comments-only placeholder;
- `/admin/login` was indexable;
- pages without an event cover shared with no image at all.

**Decision:**

- **schema.org JSON-LD** (`src/lib/structured-data.ts`, pure and tested),
  rendered by one `JsonLd` component:
  - **Event** on each event page:
    - Dhaka times with their offset, an in-person `Place` in Dhaka, BD,
      and the organizer;
    - **one Offer per ticket type**, priced through `money.ts` (`"1200.00"`
      BDT). Availability follows the sale state: sold out → SoldOut; not
      yet on sale or registration not open → PreOrder; the type's window
      ended or registration closed → Discontinued.
    - A past event, or one without ticket types, has no offers.
    - **A private venue is never in it:** the event comes through
      `forPublic`, and the place uses `publicVenue`, so it names only the
      public area, or just "Dhaka".
  - **Organization + WebSite** on the home page (name, logo, Facebook,
    support contact).
  - **FAQPage** on `/faq`.
    - The answers are JSX. Server Components can't import
      `react-dom/server`, so `nodeText` walks the element tree for the
      text.
    - Google shows FAQ rich results only for a few kinds of site now;
      this is for AI assistants and answer engines.
  - **Injection-safe:** titles are typed by an admin, so the JSON escapes
    `<`, U+2028 and U+2029. A title containing `</script>` stays data.
- **`sitemap.xml`**: the nine public pages, plus every published or
  archived event with its `updatedAt`.
- **`robots.txt`**: the app's own. It disallows `/admin`, `/api/`,
  `/door`, `/orders/`, `/tickets/`, `/account` and the register pages,
  and links the sitemap.
- **`/.well-known/security.txt`** (RFC 9116), pointing at SECURITY.md's
  channels, with a rolling six-month `Expires`.
- **Per request, not at build.** At build time `SITE_URL` is a
  placeholder, and a prerendered file would advertise
  `build-placeholder.invalid`. So:
  - `robots.txt`, the sitemap and security.txt render per request;
  - `metadataBase` and the Open Graph defaults live in the **public**
    layout, which renders per request anyway;
  - the share image sits in `(public)/`.

  The root layout's metadata stays static and holds no URL. It also
  covers the pages Next prerenders (the 404 page,
  `/admin/forgot-password`). A first version set `metadataBase` in the
  root layout: the Dockerfile's placeholder check refused the image, and
  production kept the previous deploy.

- **Generated images, built once:** the default share card
  (`opengraph-image`, `twitter-image`, 1200×630), the icon (512 px, also
  the Organization logo) and the Apple icon. They use the Noto Sans the
  ticket PDF already ships, so nothing is fetched from a font CDN at
  build. Event and home metadata **leave out** `images` when there is no
  cover, rather than sending an empty list, so the card applies.
- **Also:** `manifest.webmanifest` (name, colours, icons); a home title
  that says what the site is ("echoandaura · Live events and tickets in
  Dhaka"); the whole admin `noindex, nofollow` through `app/admin/layout.tsx`.
- **Left out:** an RSS feed (little value for one organizer's handful of
  events) and `llms.txt` (no major engine has said it reads it). Security
  headers are Phase 7.

**Consequences:**

- Search engines learn about a new event when they next read the
  sitemap. Search Console and Bing Webmaster need the sitemap submitted
  once (docs/infra/CLOUDFLARE.md → Search engines).
- Cloudflare's "managed robots.txt" may add its content-signals text
  around ours. Its rules are comments, so ours still decide.
- A new public page must be added to `STATIC_PUBLIC_PATHS`. A new
  private area must go into `DISALLOWED_PATHS` and also be `noindex`.

**Revisit when:** events get performers or a lineup (add `performer`), an
event can be cancelled or moved (`eventStatus`), or Bangla pages exist
(`inLanguage`, `hreflang`).

## ADR-043 — Security headers and a nonce Content-Security-Policy

**Date:** 2026-09-29 · **Status:** Accepted

**Context:** Only `/door` sent security headers (ADR-030). Every other
page sent no CSP and no HSTS, and advertised `X-Powered-By: Next.js`.
Admins type rich text that the public pages render (event descriptions,
sanitized by `RichText`); a CSP is the second line if a sanitizer bug
ever lets a script through.

**Decision:**

- **Static headers on every response** (`next.config.ts`, a
  `/:path*` rule placed before the `/door` rules so the door keeps
  `no-referrer` and `camera=(self)`):
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
    No `preload`: getting off the browsers' list takes months.
  - `X-Content-Type-Options: nosniff`;
    `Referrer-Policy: strict-origin-when-cross-origin`;
    `X-Frame-Options: DENY`; `Cross-Origin-Opener-Policy: same-origin`;
    `Permissions-Policy` turning off camera, microphone, geolocation and
    payment.
  - `poweredByHeader: false`.
- **A nonce CSP per request**, built by `src/lib/csp.ts` and set by
  `src/proxy.ts` on the request (Next reads the nonce from it and stamps
  its own scripts) and on the response:
  - `script-src 'self' 'nonce-…' 'strict-dynamic'`: only scripts with
    this request's nonce run, plus the chunks they load. No
    `'unsafe-inline'`.
  - `/door` adds `'wasm-unsafe-eval'` for the QR decoder; `worker-src
'self'` covers its service worker (ADR-035).
  - `img-src` allows `R2_PUBLIC_URL`'s origin (sponsor logos load from
    it directly), `data:` and `blob:` (the logo preview).
  - `connect-src` is `'self'`, plus `R2_ENDPOINT`'s origin **on signed-in
    admin pages only** (not sign-in or password reset): cover and logo
    uploads PUT straight to storage with a presigned URL (ADR-007). The
    first e2e run caught exactly this.
  - `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
    `form-action 'self'`, everything else `'self'`.
  - **Styles keep `'unsafe-inline'`.** The UI uses `style={…}` widely,
    and the shadcn chart writes a `<style>`. A style can't run code.
  - Dev adds `'unsafe-eval'` (React's error overlay).
  - Not on API routes, build assets, the image optimizer, `/vendor` or
    the service worker file: they carry no HTML.
- **Nonces need pages rendered per request.** Almost every page already
  was. The two Next prerendered are now dynamic:
  - `/admin/forgot-password` calls `connection()`;
  - a root `app/not-found.tsx` wraps the public 404 in the public
    layout. Unknown URLs used to get Next's unbranded default 404.
  - Still prerendered: Next's `_global-error` page (shown only when the
    root layout itself fails). It is plain HTML and reads fine without
    its scripts.
- **The e2e suite is the CSP test.** Every spec imports `test` from
  `tests/e2e/test.ts`, whose automatic fixture fails a test on any CSP
  violation in the browser, including the contexts the door specs open.
  The suite runs the production build, so the real policy is enforced.

**Consequences:**

- A new third-party script, font, image host, frame or connection needs
  a CSP change first; the e2e suite points at the violation.
- An inline `<script>` of our own would need the nonce, which the proxy
  would then also have to hand to the page (an `x-nonce` request
  header, per Next's CSP guide). JSON-LD is exempt: it is data and never
  runs.
- A page that becomes static loses its nonce and its scripts are
  blocked: keep pages dynamic, or revisit SRI (`experimental.sri`).
- HSTS covers every subdomain for a year: a new subdomain must serve
  HTTPS from day one.

**Revisit when:** Next's SRI leaves experimental (static pages with a hash
CSP); an analytics or payment script is added; or `preload` is wanted.

## ADR-044 — A least-privilege database role for the app

**Date:** 2026-09-29 · **Status:** Accepted

**Context:** The web app, the worker and the migrations all connected as
`echoandaura`, the Postgres image's `POSTGRES_USER`, which is a
superuser. A SQL injection or a bad bug would have had every right in
the cluster: drop tables, read other databases, rewrite the audit trail
that invariant 6 depends on, even run programs on the server
(`COPY … TO PROGRAM`).

**Decision:**

- **Two roles on the same database.**
  - `echoandaura` stays the owner. Only the `migrate` service
    (`MIGRATE_DATABASE_URL`) and Dokploy's backups use it.
  - `echoandaura_app` is what web and worker use (`DATABASE_URL`). It
    can `SELECT, INSERT, UPDATE, DELETE` every table in `public`, and use
    their sequences. No `TRUNCATE`, no DDL, nothing in the `drizzle`
    schema, no superuser, role or database creation.
- **The audit trails are append-only in the database.** `order_events`
  and `door_scans` get no `UPDATE` or `DELETE`. The code never did
  either (only the local seed script does, as the owner); now a bug or
  an injection can't either.
- **The grants are code.** `ops/db/app-role.sql` is committed, holds no
  password and is safe to re-run. `ALTER DEFAULT PRIVILEGES` gives the
  app role the same rights on tables a later migration creates, because
  the script and the migrations run as the same owner.
- **Tested in CI.** `tests/integration/db-role.test.ts` applies the
  script twice to the CI database, then checks **every** table in
  `public` (not a list, so a new table can't slip through), the
  append-only pair, the refusals (update/delete of the audit trail,
  truncate, create, drop, the migration journal), everyday row work as
  the role, and a freshly created table.
- **The e2e suite runs as the app role.** `prepare-db` migrates and wipes
  as the owner, then applies the script; the server under test (and the
  `create-admin` runs) connect as `echoandaura_app`, like production. So
  every page and action the suite covers proves the grants are enough.
  The role's password there is a fixed, local-only one.
- **Restores apply the grants from the repo.** Backups are restored with
  `--no-acl`, then `app-role.sql` runs. A backup's grants name a role that
  a rebuilt server doesn't have yet, which would stop the restore.
- **The password never passes through a shell.** The script creates the
  role without one; the operator sets it with psql's `\password`.

**Consequences:**

- Production has two connection strings (SERVER.md § 19,
  SECRETS.md). Local dev keeps one owner URL; only the e2e server
  switches to the role.
- A new append-only table must be added to `app-role.sql` and to
  `APPEND_ONLY` in the test; the test fails until it is.
- The app role can still read and change every row, including buyer
  details and admin password hashes. This limits the blast radius; it
  does not replace the app's own checks.
- `SELECT … FOR UPDATE` needs `UPDATE`: fine on `orders`, `tickets` and
  `door_passes`, which keep it. A future row lock on an append-only table
  would fail and show up in the tests.

**Revisit when:** a second app shares the database (its own role), or
buyer PII should be readable only through views (column-level grants).

## ADR-045 — Only Cloudflare reaches the origin

**Date:** 2026-09-29 · **Status:** Accepted

**Context:** The site is proxied by Cloudflare, but the server answered
anyone: `curl --resolve echoandaura.com:443:160.25.226.166` returned the
site with a 200. The address was public (the DNS-only `deploy` record,
DNS history, certificate logs). Rate-limit keys were already safe from
spoofing (ADR-037), but anyone skipping Cloudflare also skipped its DDoS
protection and any WAF or rate-limit rule added there. On a 2-vCPU
server, a flood straight at the origin would take the site down during a
sale.

**Decision:**

- **The server accepts 80/443 from Cloudflare's ranges only.**
  - IPv4: Docker publishes Traefik through NAT, so the traffic passes
    `FORWARD`, not ufw. `ops/server/origin-lockdown` adds a jump from
    `DOCKER-USER` (the chain Docker leaves to the operator) to its own
    `ORIGIN-LOCKDOWN` chain: Cloudflare's ranges return, everything else
    drops. Only new inbound connections on `eth0` are matched
    (`--ctdir ORIGINAL`), so the containers' own outgoing traffic is
    untouched. UDP 443 too.
  - IPv6: Docker serves it through `docker-proxy`, which ufw does filter,
    and Cloudflare reaches the origin over IPv4. So ufw's 80/443 rules
    are deleted. The script sets the IPv6 `DOCKER-USER` rules anyway, in
    case Docker starts NAT-ing IPv6.
  - A systemd unit runs the script after Docker starts and again
    whenever Docker restarts (`PartOf=docker.service`), because
    `DOCKER-USER` rules don't survive a reboot on their own. The script
    is idempotent and has `status` and `remove` (an instant rollback).
- **`deploy` is proxied too.** Otherwise the dashboard and GitHub's deploy
  call would be locked out with everyone else. This reverses the earlier
  "DNS only" choice (SERVER.md § 9), whose reason was that bot checks
  could block the deploy call: a WAF custom rule now skips Cloudflare's
  challenges for `deploy.echoandaura.com/api/*`. Dokploy's API key
  still guards those calls. Bot Fight Mode stays off (it can't be skipped
  per path on the free plan).
- **One list of Cloudflare ranges, three copies:** the app
  (`src/lib/client-ip.ts`), Traefik's `trustedIPs`, and this script. A
  unit test keeps the script equal to the app.
- **Checked from outside:** `pnpm infra:check` expects `deploy` to resolve
  to Cloudflare, and a direct HTTPS request to the server's address to
  get no answer.

**Consequences:**

- The site and the dashboard go through Cloudflare, including its limits
  (100 s per request, 100 MB uploads): fine for Dokploy's API and the
  app.
- Debugging "straight at the server" now means the SSH tunnel (SERVER.md
  § 9), which the lockdown never blocks.
- When Cloudflare changes its ranges, all three copies change together;
  a range missing from the script drops real visitors routed through it.

**Rejected:** Cloudflare Tunnel (no open ports at all, but a new daemon in
the request path and a bigger change to Traefik's setup); Authenticated
Origin Pulls (mTLS) alone (packets still reach Traefik and cost CPU
before being refused).

**Revisit when:** the server gets a second public service, or Cloudflare
Access is put in front of the dashboard.

## ADR-046 — Limits on placing orders: two open per phone, twenty per network

**Date:** 2026-09-30 · **Status:** Accepted

**Context:** The Phase 7.6 security review found that registration had no
limit at all. Every order holds up to 10 seats for 24 hours, and only the
buyer (by paying) or the expiry job releases them. About ten scripted
requests could make a 100-seat event "sold out" for a day, and the phone
numbers on the form aren't verified, so they can be made up. The load
test (docs/LOAD-TEST.md) had shown the flow correct under a rush; this is
about who may take part in it.

**Decision:**

- **At most two open orders per phone number per event**
  (`MAX_OPEN_ORDERS_PER_BUYER`, `orders.service.ts`). "Open" means
  awaiting verification, or awaiting payment with a hold that hasn't
  lapsed (a lapsed hold stops counting even before the expiry job runs).
  Two leaves room for a second order for friends.
  - Checked **inside the order transaction, before any seat is held**,
    under a transaction-scoped advisory lock keyed on event + phone
    (`ordersRepository.lockBuyer`). Without it, parallel submits from one
    phone would each count zero open orders and all get through. The lock
    is per buyer, so nobody else waits on it.
  - A refusal holds nothing and writes nothing, and the buyer is told why
    and pointed at "Find my order".
- **At most 20 new orders per IP per 15 minutes**, in the register action,
  on the existing Redis limiter. Generous on purpose: Bangladeshi mobile
  carriers put many buyers behind one address (CGNAT). A limiter outage
  lets the order through; the per-phone cap still holds. Off for the e2e
  suite (`APP_ENV=test`), which registers from one address, like the
  sign-in limiter.
- **A Cloudflare rate-limiting rule** is the outer layer (Phase 7.6
  infra). The free plan can't match form posts alone, so it counts every
  request per address: see ADR-047.

**Consequences:**

- A hoarder now needs many phone numbers **and** many networks; each extra
  phone buys at most 20 seats (2 × 10) until the holds lapse.
- A buyer who abandoned two orders must wait for a hold to lapse (24 h) or
  pay one before ordering again. The message says so. The admin can't
  release an unpaid hold early; if that becomes a problem, that is the
  feature to add.
- Tests: unit (the cap, what counts as open, lock before count before
  hold), integration against Postgres (eight simultaneous submits from one
  phone → exactly two orders; other buyers unaffected; a lapsed hold frees
  the slot), e2e (the third order shows the message and keeps the form),
  and the load test's rush now sends a distinct address per buyer.

**Revisit when:** buyers verify their phone (an OTP makes the phone a real
identity, so the IP limit could loosen), or an event sells far more seats
than one person could plausibly want.

## ADR-047 — Load shedding: a cap on requests in flight, and a rate limit per address

**Date:** 2026-09-30 · **Status:** Accepted

**Context:** The load test (docs/LOAD-TEST.md) found how the site fails
under a flood: requests queue inside Node until the web's heap (half the
container's 1 GB) fills, and the process crashes and restarts. Launch
traffic is far below that, but one script or a viral post could cause
it, and the restart drops everyone mid-order. The security review
(ADR-046) also wanted an outer rate limit in front of the app.

**Decision:**

- **Traefik's `inFlightReq` middleware, `amount: 100`, on the `websecure`
  entrypoint** (docs/infra/SERVER.md § 21). Over 100 requests in
  progress for the host, Traefik answers 429 at once instead of
  queueing. On the entrypoint, not the app's router, because Dokploy
  regenerates the router labels on every deploy.
  - **Why 100 and not the faster 40.** On the load stack, 40 served a
    sustained flood best (72 pages a second, admitted p95 under a
    second, against about 30 at 60 and above). But 200 buyers pressing
    "Register" together got 40 holds and 160 instant refusals at 40,
    with seats left over; at 100 every seat went. At 100 in flight the
    web stayed near 250 MB even at 220 views/s, so the crash is gone
    either way. The on-sale burst happens at every event; a sustained
    flood from many addresses is Cloudflare's DDoS protection's job.
  - The default grouping (by `Host`) is what we want: behind Cloudflare
    every client address is Cloudflare's anyway.
- **One Cloudflare rate-limiting rule** (the free plan's only one):
  150 requests per 10 s per IP, everything except `/_next/`, block for
  10 s (docs/infra/CLOUDFLARE.md). The free plan matches on the path
  only, so it can't target form posts; counting pages, prefetches,
  posts and API calls together still stops one address from taking the
  in-flight budget from everyone else. Set well above one person
  because mobile carriers put many buyers behind one address.
- **The load stack mirrors it:** `ops/load/traefik/` and `--profile shed`
  put the same middleware in front of the web, so a change to the cap is
  measured before it is made.

**Consequences:**

- Under overload some visitors see a plain "Too Many Requests" (Traefik's
  or Cloudflare's) and try again, instead of everyone waiting until the
  process dies. A friendlier page would need a server that isn't the
  overloaded web.
- The cap is on the host, so door phones and admins share it with the
  public on event night; they are a handful of requests.
- Dokploy rewrites `traefik.yml` for some settings changes; SERVER.md
  § 21 has the check (`grep -c inflight-cap`).

**Rejected:** a cap in the app (Node would still accept and parse every
request); a queue in front of the web (Traefik has none, and a waiting
room is out of proportion for this size); Traefik's `rateLimit` per
address (it would duplicate Cloudflare's rule on the CPU being
protected, and must pick the visitor out of `X-Forwarded-For` exactly as
the app does).

**Revisit when:** the web runs as more than one replica (the cap is per
host, not per replica), public pages are cached at Cloudflare, or the
server changes size: re-measure on the load stack first.

## ADR-048 — Bot check: Cloudflare Turnstile on the public forms

**Date:** 2026-10-02 · **Status:** Accepted · supersedes the sign-in limiter parts of ADR-019 and the reset rate rule of ADR-038

**Context:** The limits of ADR-046/047 count per phone and per address,
and a script can bring many of both. Five public forms cost us something
real on every submit: an order holds seats for 24 hours, the sign-in and
reset forms send an email, Find my order is a lookup that can be
enumerated, and the admin login takes password guesses. better-auth also
served three of them over HTTP (`/sign-in/email`, `/sign-in/magic-link`,
`/request-password-reset`), so a bot could post there and skip our server
actions and their limits entirely. The site already sits behind
Cloudflare (ADR-045), which offers Turnstile free.

**Decision:**

- **Turnstile on five forms:** registration, Find my order, buyer sign-in,
  admin login, admin forgot password. Each has its own `action`
  (`TURNSTILE_ACTIONS`, `src/lib/turnstile-config.ts`).
  - **Not on the trxID payment form:** it is reachable only from an
    order's own page, the trxID is unique in the database (Invariant 3)
    and a person checks every one. A challenge there would only stand
    between a paying buyer and their tickets.
  - **Not on the promo code "Apply" check:** it changes nothing and
    sends nothing; the order it leads to is checked anyway.
- **Order in each server action:** Zod parse → `passesHumanCheck` →
  the existing rate limiter → the service or auth call. A refused check
  returns the form's normal error (`HUMAN_CHECK_FAILED`) with the typed
  values kept; nothing is held, sent or counted against a limiter, so a
  bot can't spend a real buyer's (or the admin's) budget.
- **Per-form action and hostname claims.** Siteverify echoes the action
  and the host the token was solved on; both must match, so a token
  solved on one form, or on someone else's site with our public site
  key, is refused. The verifier runs before any service call, never
  inside a transaction (Invariant 7).
- **Fail open on Cloudflare, fail closed on us.** A network error,
  timeout, 5xx, unknown answer or `internal-error` lets the submit
  through (logged `warn`): the site is served through Cloudflare, so an
  outage there is rare and short, the limits and the per-phone cap still
  hold, and refusing would close registration for everyone because of a
  third party. A rejected secret (`invalid-input-secret`) refuses every
  submit and logs `error` (`turnstile secret rejected by Cloudflare`):
  allowing would switch the bot check off without anyone noticing, and
  the deploy checklist catches it in a minute.
- **Test keys are refused when deployed.** `readTurnstileConfig` throws
  for `APP_ENV` staging or production when either key is missing or is a
  Cloudflare test key, because the test secret accepts a dummy token
  anyone can send. Dev, CI, the e2e suite and the load stack (which
  runs the production image with `APP_ENV=local`) default to the test keys,
  and the action and hostname claims are skipped there (test answers
  carry neither).
- **The site key is read at request time** and passed from the page to
  the form as a prop, not `NEXT_PUBLIC_*`: images are built with
  placeholder env (ADR-036).
- **better-auth's HTTP endpoints for those forms are disabled**
  (`disabledPaths` in `src/lib/auth-options.ts`): `/sign-in/email`,
  `/sign-in/magic-link`, `/request-password-reset`, and the unused
  `/send-verification-email`. The server actions call `auth.api.*`
  directly, which disabled paths don't affect; the token links in the
  emails (`/magic-link/verify`, `/reset-password`) stay open.
- **The widget resets after every server answer.** A token is single-use,
  so the form's action state is the widget's reset signal; otherwise a
  second submit after any error would always fail the check. It renders
  `interaction-only`: most visitors never see it.
- **A submit before the token exists is held, not refused.** A quick
  click or a password manager submitting on autofill would otherwise
  post with no token and get the bot message (the e2e suite's sign-ins
  failed this way). The widget prevents that submit, says "Checking you
  are not a bot", and sends it when the token arrives; if the widget
  fails instead, it sends it anyway so the server answers with the bot
  message.
- **No-JS posts are no longer supported on these five forms.** The token
  comes from Cloudflare's script; the widget shows a `<noscript>` note.

**Consequences:**

- Two new required variables in production, `TURNSTILE_SITE_KEY` and
  `TURNSTILE_SECRET_KEY` (docs/ENVIRONMENT.md § Bot check); without them
  the production compose file refuses to start, and with test keys the
  five form pages throw. The widget is created in the Cloudflare
  dashboard (docs/infra/CLOUDFLARE.md § Turnstile).
- `frame-src https://challenges.cloudflare.com` in the CSP; the script
  itself loads from our bundle under `'strict-dynamic'` (ADR-043).
- better-auth's own limiter never ran on `auth.api` calls, so the admin
  login now has its own: every attempt counts per IP (10 a minute), and
  only wrong passwords count per address _from that IP_ (5 per 15
  minutes, checked before the attempt, counted after an `APIError`).
  Not an address-wide count: Turnstile makes a guess cost one solve, not
  a refusal, so anyone willing to solve 5 widgets every 15 minutes (a
  person, a solving service, or anyone while siteverify fails open)
  could keep the real admin out with the right password, and stall
  payment approvals. The price: a guesser spread over many IPs is held
  only by the per-IP limit, Turnstile and the password's strength.
  The forgot-password per-address limit (3 per 15 minutes) can still be
  spent by anyone; it only delays a reset email and never blocks a
  sign-in.
- A visitor with a strict content blocker, or without JavaScript, can't
  send these forms; the widget says so. Accepted: a bot check that works
  without a script is no check.
- One extra request to Cloudflare per submit (3 s timeout), outside any
  transaction.
- Tests: unit for the verifier (each refusal reason, fail open vs
  closed, no fetch for a missing token) and for each protected action
  (refused before the limiter and the service, values kept); the e2e
  suite runs on the test keys.

**Rejected:** better-auth's captcha plugin (it guards only better-auth's
own HTTP endpoints, not our server actions; we disable those endpoints
instead); reCAPTCHA or hCaptcha (another third party seeing every
visitor, a weaker privacy story, more CSP sources, and Turnstile comes
with the Cloudflare we already use); a check on every form (the trxID and
promo forms above gain nothing and lose buyers).

**Revisit when:** Cloudflare's Turnstile analytics show real solve
failures for buyers (a network or browser we can't serve), bots get
through anyway (move to Bot Fight Mode or a paid bot plan), or the site
leaves Cloudflare.
