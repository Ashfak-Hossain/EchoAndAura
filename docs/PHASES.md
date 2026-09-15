# Build Phases

**Hard deadline: 11 September** — registration opens 20 days before the
1 October event. That is when money must be collectable, not 1 September.

Phases 0-4 are required for that date. Phases 5-7 follow after.

---

## Phase 0 — Foundation (1 day)

Scaffold, dependencies, Docker, CI, Drizzle schema, `money.ts`, seed script,
and the failing concurrency test.
**Exit:** `pnpm verify` green, `docker compose up` works, concurrency test fails
for the right reason (nothing implemented yet).

## Phase 1 — Admin & events (3 days)

better-auth admin login, event CRUD, ticket type CRUD, R2 image upload,
publish/unpublish, admin layout.
**Exit:** Raj can create an event with three ticket types and publish it.

## Phase 2 — Public pages (3 days)

Event listing, event detail page with SEO and Open Graph tags, archive page,
static pages (about, FAQ, terms, privacy, refund), mobile-first layout.
**Exit:** an event page shares correctly on Facebook with image and title.

## Phase 3 — Registration & manual payment (4 days) [CORE]

Registration form, atomic inventory hold with 24h TTL, order creation,
payment instructions page, transaction ID submission, expiry job.
**Exit:** concurrency test green; an order holds inventory and expires correctly.

## Phase 4 — Verification & ticket delivery (3 days) [CORE]

Admin verification queue, approve/reject with audit trail, `fulfilment.service`,
ticket generation, React Email template, PDF ticket, web ticket page, re-send.
**Exit:** approve an order -> ticket email arrives -> web ticket page renders.

### === MVP COMPLETE — deployable, can take real money ===

## Phase 5 — Commerce features (3 days)

Promo codes, group discounts, complimentary tickets, attendee name transfer.

## Phase 6 — Admin depth & ops (3 days)

Orders search, CSV export, check-in list, sales reports, cancel ticket,
analytics, deployment, backups, monitoring, RUNBOOK.md.

## Phase 7 — Hardening & launch (2 days)

Load test, security pass, UAT with Raj, training session, go-live.

## Post-launch (not in the 11 Sept window)

Custom field builder per event, Bangla localisation, QR scanner PWA,
waitlist, reminder emails.

---

## Risk register

| Risk                                 | Impact                  | Mitigation                            |
| ------------------------------------ | ----------------------- | ------------------------------------- |
| Personal bKash hits receiving limits | Payments fail mid-event | Merchant account — resolve now        |
| Domain not chosen                    | Blocks email entirely   | Decide this week                      |
| Manual verification backlog          | Angry buyers waiting    | Agree an SLA with Raj (e.g. 4h)       |
| Scope creep from blank spec fields   | Deadline miss           | Everything unanswered is out of scope |
