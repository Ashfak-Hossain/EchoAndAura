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

**Consequences:** Public copy avoids QR wording (no scanning at the gate);
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

**Date:** 2026-09-19 · **Status:** Accepted

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

**Date:** 2026-09-21 · **Status:** Accepted

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

**Date:** 2026-09-21 · **Status:** Accepted

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

**Date:** 2026-09-21 · **Status:** Accepted

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
