# Architecture

Status: ACTIVE · Owner: unassigned · Last updated: 2026-08-21

The invariants that protect money and inventory live in
[../CLAUDE.md](../CLAUDE.md) and are deliberately not repeated here in full —
that file is kept short because it's loaded every turn. This doc is the
longer-form system picture: how the pieces fit together and why. Rendered
diagrams (ER, class, state machine, sequence) live in [DIAGRAMS.md](DIAGRAMS.md).

---

## System diagram

```
                         ┌──────────────────────────┐
   Buyer / Admin  ─────► │   Next.js 15 App         │
   (browser)             │   (App Router)           │
                         │                          │
                         │  (public)/ events,       │
                         │            register,     │
                         │            ticket/[..]   │
                         │                          │
                         │  (admin)/  verify,       │
                         │            events CRUD   │
                         │                          │
                         │  api/      route         │
                         │            handlers      │
                         └──────┬────────┬──────────┘
                                │        │
                     src/server/│        │ enqueue job
                     (no next/* │        ▼
                      imports)  │   ┌───────────┐
                                │   │  Redis 7  │
                                │   │  BullMQ   │
                                │   └─────┬─────┘
                                │         │
                                ▼         ▼
                         ┌───────────┐ ┌────────────────┐
                         │ Postgres  │ │ worker.ts      │
                         │    17     │ │ (tsx process)  │
                         └───────────┘ │ - send email   │
                                       │ - expire holds │
                                       └──────┬─────────┘
                                              │
                                    ┌─────────┴─────────┐
                                    ▼                   ▼
                               ┌─────────┐        ┌───────────┐
                               │ Resend  │        │ R2 (S3)   │
                               │ + React │        │ event     │
                               │ Email   │        │ images    │
                               └─────────┘        └───────────┘
```

The web process never talks to Resend or R2 for anything that must happen
inside a DB transaction — see [../CLAUDE.md § Invariant 7](../CLAUDE.md).
Route handlers and server actions call into `src/server/`, which owns all
business logic; the worker imports the same services directly rather than
duplicating logic.

## Request / order-state flow

A fuller narrative of the state machine summarized in `CLAUDE.md`:

1. **Registration** — buyer picks a ticket type and quantity on the event
   page. The order is created `pending_payment`, and the atomic inventory
   UPDATE (`CLAUDE.md`, Invariant 2) reserves stock. If it returns zero rows,
   the buyer sees sold-out — no read-then-write race.
2. **Payment instructions** — the order stays `pending_payment`. The buyer
   sees the organizer's bKash number and is prompted for a trxID and
   sending number. The 24h hold clock starts at order creation, not at trxID
   submission (see [DECISIONS.md — ADR-002](DECISIONS.md)).
3. **Submission** — buyer pastes trxID (normalised uppercase/trimmed) and
   sending number; the order moves to `pending_verification`. The UNIQUE
   index on `orders.bkash_trx_id` (`CLAUDE.md`, Invariant 3) rejects reuse
   at the database level regardless of any application-level check. Only
   `pending_payment` orders expire; a submitted trxID is resolved by a
   person, never by the clock (ADR-012, ADR-013).
4. **Verification** — admin opens the queue, cross-checks the trxID and
   amount against the bKash statement, and approves or rejects.
5. **Fulfilment** — `fulfilment.service.ts` (`CLAUDE.md`, Invariant 4) is the
   only code path that marks an order `paid`, converts held inventory to
   sold, and queues the ticket email. On reject or 24h expiry, the worker
   releases the hold instead.
6. **Post-issue** — an admin can cancel an issued ticket later, releasing its
   inventory; refunds happen outside the system.

Every transition above writes a row to `order_events` (`CLAUDE.md`,
Invariant 6) — that table, not application logs, is the audit trail.

## Event status flow

Events have their own, smaller state machine, validated in code the same
way (`src/server/lib/event-status.ts`; see
[DECISIONS.md — ADR-006](DECISIONS.md)):

```
draft ⇄ published
draft → archived · published → archived · archived → draft
```

`draft → published` is gated by a readiness check (at least one ticket
type, start in the future, valid registration window). The status change
itself is a conditional `UPDATE … WHERE status = <expected>`, so two admin
sessions can't race each other.

## Data model overview

Entities and their relationships, not full DDL (that lives in `drizzle/`,
generated — never hand-edited):

- **events** — one event, has many `ticket_types`; `image_key` names its
  cover in object storage; `presenting_sponsor_id` optionally names the
  sponsor shown as "Presented by" (`ON DELETE SET NULL`)
- **ticket_types** — belongs to an event; holds `quantity_total`,
  `quantity_sold`, `quantity_reserved`; may have its own sales window (Early
  Bird is a row here, not a price-change rule)
- **orders** — belongs to one `ticket_type` (one order = one ticket type, any
  quantity, max 10); carries `bkash_trx_id` (unique), status, buyer contact
- **order_events** — append-only, belongs to an `order`; who/what/when,
  old status, new status
- **promo_codes** — percentage or fixed, optionally restricted to specific
  `ticket_types`
- **tickets** — issued on fulfilment; named and transferable, attendee name
  editable until registration closes; `checked_in_at / _by / _scan_id` once
  scanned at a gate (ADR-030)
- **door_passes** — one per event gate: a 12-symbol code, revocable; its
  working window is derived from the event's dates, never stored
- **door_scans** — append-only log of every answered gate scan, keyed by the
  phone's `scan_id` (UNIQUE) so a retried request replays its answer
- **sponsors** — shown on the home page and in the footer; a `level`
  (presenting, partner, supporter — at most one presenting, by a partial
  unique index), a dense `position` within the level, `active`, a light or
  dark `tile_tone`, and `logo_key` plus the logo's measured width and
  height (ADR-032)

Images live in object storage (R2; MinIO locally), and rows store keys,
never URLs. Event covers are uploaded by the browser with a presigned PUT
(ADR-007). Pages show covers through Next's image optimizer
(`/_next/image`). It fetches the original from the storage host, and only
from there, then serves a WebP resized for each placement. The results are
cached on disk under `.next-build/cache/images` (ADR-033). Open Graph tags
keep the raw storage URL. Sponsor logos go through the server, which checks
the file first and stores it as a download-only attachment (ADR-032). They
are drawn with a plain `<img>`.

## Directory-structure rationale

- **`src/server/` has no `next/*` imports.** The BullMQ worker
  (`src/worker.ts`) is a separate Node process, not a Next.js request — it
  can only reuse business logic that doesn't assume a Next.js runtime.
- **Repositories own DB access; services call repositories, not Drizzle
  directly.** Keeps every query in one place per table, which is what makes
  the atomic-UPDATE invariant enforceable — there's exactly one place
  `ticket_types.quantity_reserved` gets written.
- **Route handlers and server actions are thin (~15 lines).** Zod parse →
  call service → map result. Business logic in a route is the specific
  failure mode the `code-reviewer` subagent checks for.
- **Services are factories; `src/server/container.ts` is the composition
  root.** A service module depends only on repository _interfaces_
  (`createEventsService(repo)`), so importing it never opens a database
  connection; unit tests pass in-memory fakes, and the container wires the
  real repositories for the app and the worker. Services throw typed domain
  errors (`src/server/lib/errors.ts`); the app layer maps them to messages.
  The events vertical (`repositories/events.repository.ts` →
  `services/events.service.ts` → `app/admin/(protected)/events/actions.ts`)
  is the reference implementation — see
  [DECISIONS.md — ADR-005](DECISIONS.md).
- **`src/components/ui/` is shadcn-generated** and excluded from hand-editing
  by `.claude/settings.json` — regenerate via the CLI instead.

Full project structure: [DEVELOPMENT.md § Project structure](DEVELOPMENT.md).

## Deployment topology

Single VPS, Docker Compose: the Next.js app, the worker process, Postgres,
and Redis as sibling containers; R2 and Resend are external managed services.
No load balancer or multi-node setup — sized for a single-organizer platform,
not multi-tenant scale. Backup, monitoring, and incident response procedures
belong in `docs/RUNBOOK.md`, written in Phase 6 once there's real
infrastructure to document.
