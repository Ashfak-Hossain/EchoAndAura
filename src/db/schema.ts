import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
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
// Declaration order is display order: Postgres sorts an enum by it, so
// `ORDER BY level` lists presenting → partner → supporter.
export const sponsorLevel = pgEnum('sponsor_level', ['presenting', 'partner', 'supporter']);
// The tile behind the logo: dark for white or light-coloured marks.
export const sponsorTileTone = pgEnum('sponsor_tile_tone', ['light', 'dark']);

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const events = pgTable(
  'events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    description: text('description'),
    venue: text('venue'),
    // Private venue: public pages never get `venue` (events.service strips it)
    // and show the optional `venue_area` hint instead; ticket holders get the
    // venue on their tickets, PDF, calendar file and tickets email.
    venueHidden: boolean('venue_hidden').notNull().default(false),
    venueArea: text('venue_area'),
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
    // Optional "Presented by" line on the event page (Canvas 6, N11). SET
    // NULL: deleting a sponsor drops the line, never the event. A hidden
    // sponsor stays linked but is not shown (the page reads active ones only).
    presentingSponsorId: uuid('presenting_sponsor_id').references(() => sponsors.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A private venue that does not exist would make "sent with your
    // tickets" a lie: ticket holders must get one.
    check('events_hidden_venue_set', sql`NOT ${t.venueHidden} OR ${t.venue} IS NOT NULL`),
    // The FK's ON DELETE SET NULL scans events by this column on every
    // sponsor delete.
    index('events_presenting_sponsor_id_idx').on(t.presentingSponsorId),
  ],
);

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
    // NULL only on complimentary orders: the organizer issues those by email
    // and there is no bKash payment to compare a sending number against.
    buyerPhone: text('buyer_phone'),
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
    // B13: non-NULL marks a complimentary order and says why (audit only,
    // never shown to the guest). One column, so the flag and the reason can
    // never disagree.
    complimentaryReason: text('complimentary_reason'),
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
    // B13: a comp is free in full (with the check above, total = 0), was never
    // paid by bKash and never used a code — whatever code path wrote it.
    check(
      'orders_complimentary_free',
      sql`${t.complimentaryReason} IS NULL OR (${t.discountPaisa} = ${t.subtotalPaisa} AND ${t.bkashTrxId} IS NULL AND ${t.promoCodeId} IS NULL)`,
    ),
    // A comp is born issued and can only end cancelled — never pending,
    // never expired by the job, never in the verification queue.
    check(
      'orders_complimentary_status',
      sql`${t.complimentaryReason} IS NULL OR ${t.status} IN ('issued', 'cancelled')`,
    ),
    // Only a comp may lack a phone: Find my order matches reference + phone,
    // and a buyer order without one could never be found again.
    check(
      'orders_phone_unless_comp',
      sql`${t.buyerPhone} IS NOT NULL OR ${t.complimentaryReason} IS NOT NULL`,
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
    // clock_timestamp(), not now(): now() is the transaction's start, so the
    // rows one transaction writes (ticket cancelled → order cancelled, paid →
    // issued) would tie and the trail could read back out of order.
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
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
    // Public code for the web ticket page, and what the ticket QR encodes —
    // scanned at the gate with a gate pass (ADR-030).
    code: text('code').notNull().unique(),
    // 1-based place within the order ("ticket 2 of 3"), fixed at issue so
    // pages, PDFs and emails never disagree about which ticket is which.
    position: integer('position').notNull().default(1),
    // Attendee name is editable until registration closes.
    attendeeName: text('attendee_name').notNull(),
    status: ticketStatus('status').notNull().default('issued'),
    // Gate check-in (ADR-030): set once by a conditional UPDATE, never
    // overwritten; cleared only by an audited undo. `checked_in_by` is the
    // gate label, `checked_in_scan_id` the scan that did it.
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    checkedInBy: text('checked_in_by'),
    checkedInScanId: uuid('checked_in_scan_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tickets_order_id_idx').on(t.orderId),
    index('tickets_event_id_idx').on(t.eventId),
    index('tickets_event_checked_in_idx').on(t.eventId, t.checkedInAt),
    // "Ticket 2 of 3" is a database fact, not a loop index.
    uniqueIndex('tickets_order_position_uq').on(t.orderId, t.position),
    check('tickets_position_positive', sql`${t.position} >= 1`),
    check(
      'tickets_check_in_consistent',
      sql`(${t.checkedInAt} IS NULL) = (${t.checkedInBy} IS NULL) AND (${t.checkedInAt} IS NULL) = (${t.checkedInScanId} IS NULL)`,
    ),
    // Someone who walked in can never hold a cancelled ticket: undo the
    // check-in first (a cancel would put their seat back on sale).
    check('tickets_checked_in_is_issued', sql`${t.checkedInAt} IS NULL OR ${t.status} = 'issued'`),
  ],
);

// ---------------------------------------------------------------------------
// Gate check-in (ADR-030) — gate passes and the scan log
// ---------------------------------------------------------------------------

export const doorScanResult = pgEnum('door_scan_result', [
  'admitted',
  'already_in',
  'cancelled',
  'wrong_event',
  'unknown',
  'practice_ok',
  // A name-search admit whose 3 phone digits did not match the buying
  // phone: refused, and logged so repeated guessing shows up (ADR-030).
  'phone_mismatch',
  // ADR-034: an OFFLINE door turned the person away (its list was stale, or
  // it undid its own admit) though the server would have admitted them.
  // Logged only — nobody walked in, so nothing is checked in.
  'turned_away',
]);
export const doorScanMethod = pgEnum('door_scan_method', ['qr', 'typed', 'search']);
export const doorScanMode = pgEnum('door_scan_mode', ['online', 'offline', 'practice']);
// ADR-034: what an OFFLINE door phone showed the person, judged from its
// downloaded list. Recorded, never trusted — `result` is the server's own
// answer, and an offline `admitted` whose result is not `admitted` is a
// double entry the organizer sees on the check-in page.
export const doorVerdict = pgEnum('door_verdict', ['admitted', 'refused', 'practice', 'undone']);

// One pass per gate per event. The code is the bearer secret a door phone
// signs in with (~59 bits, so guessing is not a practical attack); it is
// kept in plain text so the organizer can show it again to a new phone.
// No stored expiry: the window follows the event's current dates.
export const doorPasses = pgTable(
  'door_passes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    label: text('label').notNull(),
    code: text('code').notNull().unique(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('door_passes_event_id_idx').on(t.eventId),
    check('door_passes_code_format', sql`${t.code} ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$'`),
  ],
);

// Append-only: one row per scan attempt, so "who let this person in, and
// who was turned away" is always answerable. `scan_id` comes from the
// phone and makes a retried request return the same answer.
export const doorScans = pgTable(
  'door_scans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scanId: uuid('scan_id').notNull().unique(),
    passId: uuid('pass_id')
      .notNull()
      .references(() => doorPasses.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'restrict' }),
    // The ticket code when the scan parsed as one; otherwise "<unparsed:len=N>"
    // — stray QR text (Wi-Fi passwords, URLs) is never stored.
    input: text('input').notNull(),
    result: doorScanResult('result').notNull(),
    method: doorScanMethod('method').notNull(),
    mode: doorScanMode('mode').notNull(),
    // The earlier check-in shown on an already_in, so a replay is identical.
    priorCheckedInAt: timestamp('prior_checked_in_at', { withTimezone: true }),
    priorCheckedInBy: text('prior_checked_in_by'),
    // The phone's clock — advisory only; received_at is the truth.
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    // Offline scans only (ADR-034): what the door showed. Set exactly when
    // mode = 'offline' (CHECK below).
    doorVerdict: doorVerdict('door_verdict'),
    // An offline scan that replaced an online request which got no answer:
    // that request's scan id. If IT checked the ticket in, the offline admit
    // is the same person, not a double entry.
    supersedesScanId: uuid('supersedes_scan_id'),
  },
  (t) => [
    index('door_scans_pass_id_idx').on(t.passId, t.receivedAt),
    index('door_scans_event_id_idx').on(t.eventId),
    index('door_scans_ticket_id_idx').on(t.ticketId),
    index('door_scans_offline_event_idx')
      .on(t.eventId)
      .where(sql`${t.mode} = 'offline'`),
    check(
      'door_scans_verdict_offline',
      sql`(${t.mode} = 'offline') = (${t.doorVerdict} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Sponsors — "Supported by" on the home page and in the footer (B15)
// ---------------------------------------------------------------------------

export const sponsors = pgTable(
  'sponsors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Also the logo's alt text: screen readers read it out.
    name: text('name').notNull(),
    // NULL: the logo is shown without a link.
    websiteUrl: text('website_url'),
    level: sponsorLevel('level').notNull(),
    // Object-storage key (sponsors/<id>/logo-x.svg), not a URL — like
    // events.image_key. A fresh key per upload, so a key names one file.
    logoKey: text('logo_key').notNull().unique(),
    // The logo's intrinsic shape, measured by the server on upload: the
    // tile sizing formula (lib/sponsor-fit.ts) needs its aspect ratio.
    // Double precision because an SVG viewBox can be fractional.
    logoWidth: doublePrecision('logo_width').notNull(),
    logoHeight: doublePrecision('logo_height').notNull(),
    tileTone: sponsorTileTone('tile_tone').notNull().default('light'),
    // Hidden sponsors are kept (and keep their place) but never shown.
    active: boolean('active').notNull().default(true),
    // 1…n within the level, kept dense by the service on every write.
    // Not unique: a renumber rewrites several rows in one statement, and a
    // UNIQUE (level, position) would trip mid-statement on a swap.
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One presenting partner at a time, whatever code path writes. The
    // service demotes the old one first; this is the backstop.
    uniqueIndex('sponsors_one_presenting')
      .on(t.level)
      .where(sql`${t.level} = 'presenting'`),
    check('sponsors_logo_width_positive', sql`${t.logoWidth} > 0`),
    check('sponsors_logo_height_positive', sql`${t.logoHeight} > 0`),
    check('sponsors_position_positive', sql`${t.position} >= 1`),
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
