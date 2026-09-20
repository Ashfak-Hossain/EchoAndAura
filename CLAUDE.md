# Event Ticketing Platform — Agent Instructions

Single-organizer event ticketing. Public users browse events, register, pay via
**manual bKash transfer**, and an admin verifies the transaction before tickets
are issued by email.

Read this file fully before writing code. The rules below are invariants, not
style preferences. Violating them causes financial loss or data corruption.

---

## Stack

Next.js 16 App Router · React 19 · Node 26 · TypeScript `strict` · Postgres 17 +
Drizzle 0.45 (postgres-js driver) · Redis 7 + BullMQ · Zod · better-auth (admin
password login; optional passwordless buyer sign-in) · pino · Resend + React Email · shadcn/ui + Tailwind 4 · Vitest 5 +
Playwright · Docker · Timezone `Asia/Dhaka`

> Latest majors were adopted at scaffold time — see [ADR-003](docs/DECISIONS.md).
> Drizzle stays on stable 0.45 (1.0 is still pre-release).

---

## Payment model — READ THIS FIRST

There is **no bKash API integration**. Payment is manual:

1. Buyer selects tickets and submits the registration form
2. Order is created as `pending_payment`; **inventory is held for 24 hours**
3. Buyer sends money via bKash, then pastes the transaction ID and the sending
   mobile number into the order page → order becomes `pending_verification`
4. Admin opens the verification queue, checks the trxID and amount against the
   bKash statement, and clicks Approve or Reject
5. On Approve: order → `paid`, inventory converts from held to sold, and the
   ticket email is sent **automatically** (queued, not manual)
6. On Reject or 24h expiry: inventory is released

Do not build bKash API calls, tokens, callbacks, or reconciliation jobs.

---

## THE INVARIANTS

### 1. Money is integer paisa

All amounts are `BIGINT` paisa in the DB, `number` in code. Never floats.
Conversion lives ONLY in `src/server/lib/money.ts`.

### 2. Inventory uses the conditional atomic UPDATE

Never read-then-write. One statement:

```sql
UPDATE ticket_types SET quantity_reserved = quantity_reserved + $qty
WHERE id = $id AND quantity_total - quantity_sold - quantity_reserved >= $qty
RETURNING id
```

Zero rows returned means sold out. A CHECK constraint backstops it.

### 3. Transaction IDs are unique, enforced by the database

`orders.bkash_trx_id` has a UNIQUE index. The same trxID can never be used
twice, regardless of application logic. Store it normalised: uppercase, trimmed.

### 4. Only `fulfilment.service.ts` marks an order paid and issues tickets

Called from the admin approve action. Nowhere else. Never duplicate this logic.

### 5. Prices never come from the client

Recalculate every total server-side from `ticket_types`. The request body
carries ticket type IDs and quantities only.

### 6. Every order state change writes an audit row

`order_events` is append-only: who, what, when, old status, new status.
When Raj asks "why was this order rejected," the answer must be in the database.

### 7. No HTTP calls inside a database transaction

Email, R2 uploads, anything network — queue it or do it after commit.

---

## Order state machine

```
pending_payment → pending_verification → paid → issued
                                       ↘ rejected
                                       ↘ expired   (24h TTL)
                        issued → cancelled
```

Transitions are validated in code. An invalid transition throws.

---

## Architecture rules

Full system diagram, data flow, and data model overview:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

- **All business logic in `src/server/`.** No file there may import `next/*`.
  The worker imports these services directly.
- **Route handlers and server actions are thin**: Zod parse → call service →
  map result. Target 15 lines. No business logic.
- **All I/O is queued**: email, PDF generation, exports.
- **Repositories own DB access.** Services call repositories, not Drizzle.
- `src/components/ui/` is shadcn-generated. Do not hand-edit; re-run the CLI.

## Business rules

- One order contains exactly ONE ticket type, any quantity (max 10 per order)
- Registration asks for one name (the buyer's). Every ticket starts with it;
  tickets are transferable and the attendee name on each ticket can be
  edited on the ticket page until registration closes
- Registration opens 20 days before an event and closes 5 days before
- Early Bird is a separate ticket type with its own sales window, not a
  price-change rule
- Promo codes: percentage or fixed, unlimited uses, restrictable to ticket types
- No refunds. Admin can cancel a ticket, which releases inventory; money is
  returned outside the system
- No QR scanning at the gate — check-in is a printed/exported list

## Testing

`tests/integration/inventory.concurrency.test.ts` is the most important test in
this repo. It must never be skipped or weakened. Requires real Postgres.

Every service gets unit tests. Every money or state-machine function gets tests
covering the failure path, not just the happy path.

## Working style

- Work in **vertical slices**: schema → repository → service → route → UI → test.
  One slice complete and green before starting the next.
- **Start every task in plan mode.** Present the plan, get approval, then write.
- Run `pnpm verify` before saying a task is done. If it fails, it is not done.
- Update `notes/PROGRESS.md` at the end of every session.
- Record non-obvious choices in `docs/DECISIONS.md` as a short ADR.
- Pin dependency versions exactly. No `^` ranges.
- Comment the WHY on money, inventory, and state-machine code.

## Never do

- Never edit files in `drizzle/` by hand — generate migrations
- Never commit `.env` or any secret
- Never use `any` — use `unknown` and narrow
- Never disable a test to make CI pass
- Never `git push --force` to main
- Never run destructive SQL against production

---

<!-- BEGIN AWS Agent Toolkit rules -->
# AWS Guidance

- Where these AWS rules conflict with the project's own instructions, the
  project's instructions take precedence.
- Prefer the AWS MCP Server for AWS interactions — it provides sandboxed
  execution, observability, and audit logging. If unavailable, use the
  AWS CLI directly.
- Before starting a task, check whether a relevant AWS skill is available.
  Load the skill with `retrieve_skill` and prefer its guidance over
  general knowledge.
- When uncertain about specific AWS details (API parameters, permissions,
  limits, error codes), verify against documentation rather than guessing.
  State uncertainty explicitly if you cannot confirm.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or
  CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework
  principles.
- Do not use em dashes in AWS resource names or descriptions. Use
  hyphens instead.

## Secret Safety

- MUST load the `aws-secrets-manager` skill first for any secret,
  credential, API key, token, or password task. MUST NOT call
  `secretsmanager get-secret-value` or `batch-get-secret-value`, and MUST
  NOT hit the Secrets Manager Agent daemon directly. MUST use
  `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with
  `asm-exec` so the secret resolves at runtime without entering context.
<!-- END AWS Agent Toolkit rules -->
