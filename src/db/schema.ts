import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const eventStatus = pgEnum('event_status', ['draft', 'published', 'archived']);

// Mirrors the order state machine in CLAUDE.md. This enum bounds the possible
// values; the service layer validates that a given transition is legal.
export const orderStatus = pgEnum('order_status', [
  'pending_payment',
  'pending_verification',
  'paid',
  'issued',
  'rejected',
  'expired',
  'cancelled',
]);

export const promoType = pgEnum('promo_type', ['percentage', 'fixed']);
export const ticketStatus = pgEnum('ticket_status', ['issued', 'cancelled']);
// Personal accounts receive by "Send Money" and have limits; a merchant
// account receives by "Payment". The buyer-facing wording follows it.
export const bkashAccountType = pgEnum('bkash_account_type', ['personal', 'merchant']);

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const events = pgTable('events', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  description: text('description'),
  venue: text('venue'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  // Business rule: registration opens 20 days before, closes 5 days before the
  // event. Stored explicitly so a specific event can override the default.
  registrationOpensAt: timestamp('registration_opens_at', {
    withTimezone: true,
  }),
  registrationClosesAt: timestamp('registration_closes_at', {
    withTimezone: true,
  }),
  status: eventStatus('status').notNull().default('draft'),
  // Object-storage key of the cover image (e.g. events/<id>/cover-x.jpg), not
  // a URL: the public URL is derived at render time, so moving buckets or
  // changing the public domain never touches rows.
  imageKey: text('image_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Ticket types
// ---------------------------------------------------------------------------

export const ticketTypes = pgTable(
  'ticket_types',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Money is integer paisa (Invariant 1): BIGINT in the DB, number in code.
    pricePaisa: bigint('price_paisa', { mode: 'number' }).notNull(),
    quantityTotal: integer('quantity_total').notNull(),
    quantitySold: integer('quantity_sold').notNull().default(0),
    quantityReserved: integer('quantity_reserved').notNull().default(0),
    // Early Bird is a ticket type with its own sales window — NOT a price rule.
    salesStartsAt: timestamp('sales_starts_at', { withTimezone: true }),
    salesEndsAt: timestamp('sales_ends_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ticket_types_event_id_idx').on(t.eventId),
    // Backstops the atomic reservation UPDATE (Invariant 2): the database
    // itself refuses to let available stock go negative, even if the
    // application logic ever regresses into a read-then-write race.
    check(
      'ticket_types_availability_nonneg',
      sql`${t.quantityTotal} - ${t.quantitySold} - ${t.quantityReserved} >= 0`,
    ),
    check('ticket_types_sold_nonneg', sql`${t.quantitySold} >= 0`),
    check('ticket_types_reserved_nonneg', sql`${t.quantityReserved} >= 0`),
    check('ticket_types_price_nonneg', sql`${t.pricePaisa} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Promo codes
// ---------------------------------------------------------------------------

export const promoCodes = pgTable(
  'promo_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Stored normalised: uppercase, trimmed.
    code: text('code').notNull().unique(),
    type: promoType('type').notNull(),
    // Meaning depends on `type`: 'percentage' → whole percent (1–99);
    // 'fixed' → discount in paisa. bigint holds paisa safely.
    value: bigint('value', { mode: 'number' }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 1–99: a 100% code would make every order ৳0, which bKash cannot pay
    // (free tickets are complimentary tickets, B13). ADR-027.
    check(
      'promo_codes_percentage_range',
      sql`${t.type} <> 'percentage' OR (${t.value} >= 1 AND ${t.value} <= 99)`,
    ),
    check('promo_codes_value_positive', sql`${t.value} > 0`),
    // The unique index compares bytes: a code that is not in the stored form
    // ("dhaka15" beside "DHAKA15", or one with a space) could never match a
    // buyer's normalised lookup. The database refuses anything but the exact
    // format the app writes (lib/promo.ts PROMO_CODE_PATTERN).
    check('promo_codes_code_format', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9-]{1,22}[A-Z0-9]$'`),
  ],
);

// Restricts a promo code to specific ticket types (many-to-many). A code with
// no rows here applies to every ticket type.
export const promoCodeTicketTypes = pgTable(
  'promo_code_ticket_types',
  {
    promoCodeId: uuid('promo_code_id')
      .notNull()
      .references(() => promoCodes.id, { onDelete: 'cascade' }),
    // RESTRICT, not cascade (B10): "no rows" means "every ticket type", so
    // deleting the last type a code is restricted to would silently turn it
    // into a code for everything. The ticket type delete is refused instead.
    ticketTypeId: uuid('ticket_type_id')
      .notNull()
      .references(() => ticketTypes.id, { onDelete: 'restrict' }),
  },
  (t) => [uniqueIndex('promo_code_ticket_types_pk').on(t.promoCodeId, t.ticketTypeId)],
);

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Human-facing reference shown to buyers; generated in the service layer.
    reference: text('reference').notNull().unique(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    // One order = exactly one ticket type (business rule).
    ticketTypeId: uuid('ticket_type_id')
      .notNull()
      .references(() => ticketTypes.id),
    quantity: integer('quantity').notNull(),
    // Prices are recomputed server-side (Invariant 5) and snapshotted here;
    // they never come from the client request body.
    unitPricePaisa: bigint('unit_price_paisa', { mode: 'number' }).notNull(),
    subtotalPaisa: bigint('subtotal_paisa', { mode: 'number' }).notNull(),
    discountPaisa: bigint('discount_paisa', { mode: 'number' }).notNull().default(0),
    totalPaisa: bigint('total_paisa', { mode: 'number' }).notNull(),
    status: orderStatus('status').notNull().default('pending_payment'),
    buyerName: text('buyer_name').notNull(),
    buyerEmail: text('buyer_email').notNull(),
    buyerPhone: text('buyer_phone').notNull(),
    // One name per ticket, captured at registration (A3 "Who is coming?").
    // Tickets do not exist until fulfilment, so the names wait here and are
    // copied onto the ticket rows when the order is issued.
    attendeeNames: text('attendee_names').array().notNull().default([]),
    // Manual bKash: the same trxID can never be used twice (Invariant 3).
    // UNIQUE at the DB level; NULL until the buyer submits it (Postgres treats
    // NULLs as distinct, so many pending orders can coexist). Stored
    // normalised: uppercase, trimmed.
    bkashTrxId: text('bkash_trx_id'),
    bkashSenderMsisdn: text('bkash_sender_msisdn'),
    promoCodeId: uuid('promo_code_id').references(() => promoCodes.id),
    // Set on reject (B8): a code from the fixed list and the organizer's
    // optional note, shown to the buyer word for word. The audit row carries
    // the same text; these columns make the current reason cheap to read.
    rejectionReason: text('rejection_reason'),
    rejectionNote: text('rejection_note'),
    // 24-hour inventory hold (ADR-002). The expiry job releases stock once this
    // passes without payment being verified.
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('orders_bkash_trx_id_uq').on(t.bkashTrxId),
    index('orders_event_id_idx').on(t.eventId),
    index('orders_ticket_type_id_idx').on(t.ticketTypeId),
    index('orders_status_idx').on(t.status),
    index('orders_hold_expires_at_idx').on(t.holdExpiresAt),
    // B9 orders search: equality on phone, prefix/substring on email, and
    // the newest-first sort with a date range.
    index('orders_buyer_email_idx').on(t.buyerEmail),
    index('orders_buyer_phone_idx').on(t.buyerPhone),
    index('orders_created_at_idx').on(t.createdAt),
    // B10 usage counts per code.
    index('orders_promo_code_id_idx').on(t.promoCodeId),
    check('orders_quantity_range', sql`${t.quantity} >= 1 AND ${t.quantity} <= 10`),
    // Invariant 3 backstop: the UNIQUE index compares bytes, so a trxID that
    // is not upper-cased and trimmed could slip past it. The database
    // refuses such a row no matter which code path wrote it.
    check(
      'orders_bkash_trx_id_normalised',
      sql`${t.bkashTrxId} IS NULL OR ${t.bkashTrxId} = upper(btrim(${t.bkashTrxId}))`,
    ),
    check(
      'orders_totals_nonneg',
      sql`${t.subtotalPaisa} >= 0 AND ${t.discountPaisa} >= 0 AND ${t.totalPaisa} >= 0`,
    ),
    // Invariant 5 backstop now that discounts are live (B10): whatever wrote
    // the row, its money adds up. Totals are never updated after insert.
    check(
      'orders_totals_consistent',
      sql`${t.subtotalPaisa} = ${t.unitPricePaisa} * ${t.quantity} AND ${t.discountPaisa} <= ${t.subtotalPaisa} AND ${t.totalPaisa} = ${t.subtotalPaisa} - ${t.discountPaisa}`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Order events — append-only audit trail (Invariant 6)
// ---------------------------------------------------------------------------

export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    // Who caused the change: 'system', 'buyer', or an admin identifier.
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    fromStatus: orderStatus('from_status'),
    toStatus: orderStatus('to_status'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('order_events_order_id_idx').on(t.orderId)],
);

// ---------------------------------------------------------------------------
// Tickets — issued on fulfilment; named + transferable
// ---------------------------------------------------------------------------

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    ticketTypeId: uuid('ticket_type_id')
      .notNull()
      .references(() => ticketTypes.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    // Public code for the web ticket page (no QR scanning at the gate).
    code: text('code').notNull().unique(),
    // 1-based place within the order ("ticket 2 of 3"), fixed at issue so
    // pages, PDFs and emails never disagree about which ticket is which.
    position: integer('position').notNull().default(1),
    // Attendee name is editable until registration closes.
    attendeeName: text('attendee_name').notNull(),
    status: ticketStatus('status').notNull().default('issued'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tickets_order_id_idx').on(t.orderId),
    index('tickets_event_id_idx').on(t.eventId),
    // "Ticket 2 of 3" is a database fact, not a loop index.
    uniqueIndex('tickets_order_position_uq').on(t.orderId, t.position),
    check('tickets_position_positive', sql`${t.position} >= 1`),
  ],
);

// ---------------------------------------------------------------------------
// Auth — managed by better-auth (admin login only; public signup is disabled)
//
// Shapes mirror better-auth 1.7's core schema exactly. JS keys must be its
// camelCase field names (the Drizzle adapter resolves columns by key); SQL
// columns are snake_case like the rest of this file. Table names are plural
// (`usePlural: true` on the adapter) — this also avoids the Postgres reserved
// word `user`. Ids are text because better-auth generates them.
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  // 'admin' (password login, the back office) or 'buyer' (passwordless,
  // "My orders"). Never settable from a request: additionalFields input=false.
  role: text('role').notNull().default('buyer'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),
    scope: text('scope'),
    // Hashed by better-auth for the email/password ("credential") provider.
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('accounts_user_id_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Settings — the one row the organizer edits (B14). A column per field, all
// nullable: NULL means "use the fallback" (the env value or the site.ts
// constant), so a fresh database needs no seed. `id` is pinned to 1.
// ---------------------------------------------------------------------------

export const settings = pgTable(
  'settings',
  {
    id: integer('id').primaryKey(),
    // Displayed as typed, "01712 345678" — what buyers copy into bKash.
    bkashReceiveNumber: text('bkash_receive_number'),
    bkashAccountName: text('bkash_account_name'),
    bkashAccountType: bkashAccountType('bkash_account_type').notNull().default('personal'),
    supportEmail: text('support_email'),
    supportPhone: text('support_phone'),
    facebookPageUrl: text('facebook_page_url'),
    // "usually within 4 hours" — quoted on the payment page and in C1.
    verificationPromise: text('verification_promise'),
    organizerName: text('organizer_name'),
    // Printed on tickets and in email footers.
    organizerAddress: text('organizer_address'),
    // Who saved it last (admin email) — the only history there is.
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('settings_single_row', sql`${t.id} = 1`)],
);

export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);
