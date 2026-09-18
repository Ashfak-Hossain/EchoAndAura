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
