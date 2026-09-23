import { addDays, addHours } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import type { DbExecutor } from '@/db/executor';
import {
  AttendeeNamesMismatchError,
  OrderNotFoundError,
  OrderReferenceCollisionError,
  OrderStatusConflictError,
  RegistrationClosedError,
  SoldOutError,
  TicketTypeNotFoundError,
  TicketTypeNotOnSaleError,
  EventNotFoundError,
  PromoCodeNotValidError,
} from '@/server/lib/errors';
import { eventPhase } from '@/server/lib/event-phase';
import { logger } from '@/server/lib/logger';
import { generateOrderReference } from '@/server/lib/order-reference';
import { assertOrderTransition, REVENUE_STATUSES } from '@/server/lib/order-status';
import { computeOrderTotals } from '@/server/lib/pricing';
import {
  describePromo,
  judgePromo,
  normalisePromoCode,
  promoAppliesTo,
  promoDiscountPaisa,
} from '@/server/lib/promo';
import { formatBDT } from '@/server/lib/money';
import { ticketTypeSaleState } from '@/server/lib/ticket-type-sale-state';
import type { EventRecord, EventsRepository } from '@/server/repositories/events.repository';
import type {
  OrderEventRecord,
  OrderRecord,
  OrdersRepository,
  QueueRow,
  OrdersSearchFilter,
  OrdersSearchPage,
  StatusTotal,
} from '@/server/repositories/orders.repository';
import type { TicketRecord, TicketsRepository } from '@/server/repositories/tickets.repository';
import type {
  PromoCodeRule,
  PromoCodesRepository,
} from '@/server/repositories/promo-codes.repository';
import type {
  TicketTypeRecord,
  TicketTypesRepository,
} from '@/server/repositories/ticket-types.repository';
import type { InventoryService } from '@/server/services/inventory.service';
import {
  type MatchedField,
  normaliseSearchTerm,
  type OrdersSearchInput,
} from '@/lib/validation/orders-search';
import { DHAKA_TZ } from '@/lib/time';

/** Inventory is held this long from order creation (ADR-002). */
export const HOLD_HOURS = 24;

/** How many fresh references to try before giving up on a collision. */
const REFERENCE_ATTEMPTS = 3;

/** Lapsed holds handled per expiry run; the job repeats every minute. */
const EXPIRY_BATCH = 200;

/** Statuses from which a buyer may submit or correct a transaction ID. */
const SUBMITTABLE = ['pending_payment', 'pending_verification'] as const;

export interface OrdersServiceDeps {
  orders: OrdersRepository;
  tickets: TicketsRepository;
  events: EventsRepository;
  ticketTypes: TicketTypesRepository;
  inventory: InventoryService;
  /**
   * B10: where promo codes are looked up. Optional so callers that never
   * price with a code need not supply it; without it every code is unknown.
   */
  promoCodes?: Pick<PromoCodesRepository, 'findByCode' | 'findById'>;
  /**
   * Opens a database transaction and runs `fn` inside it — injected so this
   * module never imports the client. Everything inside must be a database
   * write (Invariant 7: no HTTP in a transaction).
   */
  runInTransaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  now?: () => Date;
  reference?: () => string;
  /**
   * After-commit hooks — the seams for the C1 / C4 emails. They run outside
   * every transaction (Invariant 7) and their failure is logged, never
   * surfaced: an order that could not be *announced* is still an order.
   */
  onOrderCreated?: (orderId: string) => Promise<void>;
  onOrderExpired?: (orderId: string) => Promise<void>;
}

export interface CreateOrderInput {
  eventSlug: string;
  ticketTypeId: string;
  quantity: number;
  buyerName: string;
  buyerEmail: string;
  /** E.164, e.g. +8801712345678 (normalised at the boundary). */
  buyerPhone: string;
  /** One per ticket; length === quantity (enforced at the boundary). */
  attendeeNames: string[];
  /** B10: the code as typed. The discount is worked out here, never sent (Invariant 5). */
  promoCode?: string;
}

/** What Apply on the registration form learns about a code (B10). */
export type PromoCheck =
  | {
      ok: true;
      code: string;
      type: PromoCodeRule['type'];
      value: number;
      /** This event's ticket types the code covers; empty = all of them. */
      ticketTypeIds: string[];
      /** "15% off" */
      label: string;
    }
  | { ok: false; reason: PromoCodeNotValidError['reason'] };

export interface OrderView {
  order: OrderRecord;
  event: EventRecord;
  ticketType: TicketTypeRecord;
  /** Append-only audit trail, oldest first (Invariant 6). */
  events: OrderEventRecord[];
  /** Empty until fulfilment issues them. */
  tickets: TicketRecord[];
  /** B10: the code the discount came from, or null. */
  promoCode: string | null;
}

/** One verification-queue row with the derived timing the B7 table shows. */
export interface QueueEntry extends QueueRow {
  /** When the trxID was (last) submitted. */
  submittedAt: Date;
}

export interface SubmitPaymentInput {
  /** Normalised at the boundary: uppercase, trimmed, 10 alphanumerics. */
  trxId: string;
  /** E.164 (+8801…), the number the money was sent from. */
  senderMsisdn: string;
}

/**
 * Order creation (Phase 3). Reads happen before the transaction; the
 * transaction holds exactly three statements — hold, insert order, insert
 * audit row — so the row lock on ticket_types is held for microseconds and
 * a failure anywhere leaves no orphaned hold.
 */
/** B9 page size. */
export const ORDERS_PAGE_SIZE = 25;
/** CSV export cap: a single organizer's whole history fits many times over. */
export const ORDERS_EXPORT_CAP = 10_000;

export type OrdersSearchRow = QueueRow & { matchedField: MatchedField | null };

export interface OrdersSearchResult {
  rows: OrdersSearchRow[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

/** Re-exported: the definition lives with the state machine (order-status.ts). */
export { REVENUE_STATUSES };

export interface OrderTotals {
  /** Every status with at least one order under the current filter (status ignored). */
  byStatus: StatusTotal[];
  /** All orders under the filter. */
  count: number;
  /**
   * Revenue = sum over paid + issued only. Pending money is held, not
   * earned; rejected/expired never arrived; cancelled was refunded outside
   * the app. Never call this "refunds" — the app does not know them.
   */
  revenuePaisa: number;
  revenueCount: number;
}

export function summariseTotals(byStatus: StatusTotal[]): OrderTotals {
  let count = 0;
  let revenuePaisa = 0;
  let revenueCount = 0;
  for (const t of byStatus) {
    count += t.count;
    if (REVENUE_STATUSES.includes(t.status)) {
      revenuePaisa += t.totalPaisa;
      revenueCount += t.count;
    }
  }
  return { byStatus, count, revenuePaisa, revenueCount };
}

function toSearchFilter(input: OrdersSearchInput): OrdersSearchFilter {
  const term = input.q ? normaliseSearchTerm(input.q) : null;
  return {
    term,
    status: input.status,
    eventId: input.event,
    createdFrom: input.from ? fromZonedTime(`${input.from}T00:00:00`, DHAKA_TZ) : null,
    createdBefore: input.to ? addDays(fromZonedTime(`${input.to}T00:00:00`, DHAKA_TZ), 1) : null,
  };
}

/** Which of the term's interpretations this row satisfied — for the tinted cell. */
export function matchedField(row: QueueRow, term: OrdersSearchFilter['term']): MatchedField | null {
  if (!term) return null;
  if (term.reference && row.order.reference === term.reference) return 'reference';
  if (term.trxId && row.order.bkashTrxId === term.trxId) return 'trxId';
  if (term.phone && row.order.buyerPhone === term.phone) return 'phone';
  if (term.email && row.order.buyerEmail.includes(term.email)) return 'email';
  return null;
}

export function createOrdersService({
  orders,
  tickets,
  events,
  ticketTypes,
  inventory,
  promoCodes = { findByCode: async () => null, findById: async () => null },
  runInTransaction,
  now = () => new Date(),
  reference = generateOrderReference,
  onOrderCreated = async () => {},
  onOrderExpired = async () => {},
}: OrdersServiceDeps) {
  /**
   * The code must pass `judgePromo` for this event's ticket types (the same
   * judgement Apply uses) — else PromoCodeNotValidError. Read before the
   * order transaction: a code switched off in the same millisecond may still
   * apply, which is harmless — the order page shows the amount due before
   * anyone sends money.
   */
  async function resolvePromo(
    raw: string,
    eventTypes: TicketTypeRecord[],
    ticketTypeId: string,
  ): Promise<PromoCodeRule> {
    const code = normalisePromoCode(raw);
    const rule = await promoCodes.findByCode(code);
    const refusal = judgePromo(rule, eventTypes, ticketTypeId);
    if (refusal || !rule) throw new PromoCodeNotValidError(code, refusal ?? 'unknown');
    return rule;
  }

  async function afterCommit(hook: () => Promise<void>, what: string, orderId: string) {
    try {
      await hook();
    } catch (err: unknown) {
      logger.error({ orderId, err }, `orders.service: ${what} hook failed`);
    }
  }

  return {
    /**
     * @throws EventNotFoundError (unknown slug or draft), RegistrationClosedError,
     *   TicketTypeNotFoundError (not this event's), TicketTypeNotOnSaleError,
     *   AttendeeNamesMismatchError, SoldOutError, InvalidQuantityError
     */
    async createOrder(input: CreateOrderInput): Promise<OrderRecord> {
      const at = now();

      // 1. The event must be live and inside its registration window.
      const event = await events.findBySlug(input.eventSlug);
      if (!event || event.status !== 'published') throw new EventNotFoundError(input.eventSlug);

      // 2. The ticket type must be this event's and on sale. Its price is the
      //    only price that exists (Invariant 5). Both checks run before the
      //    hold so a bad id never reads as "sold out".
      const allTypes = await ticketTypes.listByEvent(event.id);
      const ticketType = allTypes.find((t) => t.id === input.ticketTypeId);
      if (!ticketType) throw new TicketTypeNotFoundError(input.ticketTypeId);

      const availableTotal = allTypes.reduce(
        (n, t) => n + Math.max(0, t.quantityTotal - t.quantitySold - t.quantityReserved),
        0,
      );
      const phase = eventPhase({ event, availableTotal, now: at });
      // 'sold_out' is a snapshot; the atomic hold below is the real answer and
      // produces the right error (SoldOutError, naming the ticket type).
      if (phase !== 'open' && phase !== 'closing_soon' && phase !== 'sold_out') {
        throw new RegistrationClosedError(phase);
      }

      const saleState = ticketTypeSaleState(ticketType, at);
      // sold_out here is a snapshot; the atomic hold below is the real answer.
      if (saleState && saleState !== 'sold_out') {
        throw new TicketTypeNotOnSaleError(ticketType.id, saleState);
      }

      // The boundary checks this too, but the service holds the invariant:
      // one name per ticket, whoever the caller is.
      if (input.attendeeNames.length !== input.quantity) {
        throw new AttendeeNamesMismatchError(input.quantity, input.attendeeNames.length);
      }

      // 3. Money, from the rows, never from the client: the ticket type's
      //    price and, when a code was entered, the promo_codes row. A code
      //    that does not apply is refused here — before any stock is held —
      //    rather than silently dropped: the buyer never pays a price they
      //    were not shown.
      const promo = input.promoCode
        ? await resolvePromo(input.promoCode, allTypes, ticketType.id)
        : null;
      const totals = computeOrderTotals({
        unitPricePaisa: ticketType.pricePaisa,
        quantity: input.quantity,
        discountPaisa: promo ? promoDiscountPaisa(promo, ticketType.pricePaisa, input.quantity) : 0,
      });

      // 4. Hold + order + audit row, atomically. Sold-out is thrown *inside*
      //    the callback so the transaction rolls back with nothing written.
      for (let attempt = 1; ; attempt++) {
        const ref = reference();
        try {
          const created = await runInTransaction(async (tx) => {
            const held = await inventory.hold(ticketType.id, input.quantity, tx);
            if (!held) throw new SoldOutError(ticketType.id, input.quantity);

            const order = await orders.insert(
              {
                reference: ref,
                eventId: event.id,
                ticketTypeId: ticketType.id,
                quantity: totals.quantity,
                unitPricePaisa: totals.unitPricePaisa,
                subtotalPaisa: totals.subtotalPaisa,
                discountPaisa: totals.discountPaisa,
                totalPaisa: totals.totalPaisa,
                promoCodeId: promo?.id ?? null,
                status: 'pending_payment',
                buyerName: input.buyerName,
                buyerEmail: input.buyerEmail,
                buyerPhone: input.buyerPhone,
                attendeeNames: input.attendeeNames,
                holdExpiresAt: addHours(at, HOLD_HOURS),
              },
              tx,
            );

            await orders.insertEvent(
              {
                orderId: order.id,
                actor: 'buyer',
                action: 'order.created',
                fromStatus: null,
                toStatus: 'pending_payment',
                note: `${totals.quantity} × ${ticketType.name}${
                  promo ? ` · ${promo.code} −${formatBDT(totals.discountPaisa)}` : ''
                }, hold until ${order.holdExpiresAt?.toISOString()}`,
              },
              tx,
            );

            return order;
          });
          await afterCommit(() => onOrderCreated(created.id), 'onOrderCreated', created.id);
          return created;
        } catch (err: unknown) {
          // The transaction rolled back (hold included); a fresh reference
          // is all that is needed. Anything else propagates.
          if (err instanceof OrderReferenceCollisionError && attempt < REFERENCE_ATTEMPTS) continue;
          throw err;
        }
      }
    },

    /**
     * B10 "Apply" on the registration form: can this code be used for this
     * event's ticket type? Read-only — the order is priced again from the
     * database on submit, whatever this said. Returns only this event's
     * ticket types, so the form can re-check when the buyer switches type.
     */
    async checkPromo(
      eventSlug: string,
      rawCode: string,
      ticketTypeId: string,
    ): Promise<PromoCheck> {
      const code = normalisePromoCode(rawCode);
      const event = await events.findBySlug(eventSlug);
      if (!event || event.status !== 'published') return { ok: false, reason: 'unknown' };
      const [rule, types] = await Promise.all([
        promoCodes.findByCode(code),
        ticketTypes.listByEvent(event.id),
      ]);
      const refusal = judgePromo(rule, types, ticketTypeId);
      if (refusal || !rule) return { ok: false, reason: refusal ?? 'unknown' };
      const here = types.map((t) => t.id).filter((id) => promoAppliesTo(rule, id));
      return {
        ok: true,
        code: rule.code,
        type: rule.type,
        value: rule.value,
        ticketTypeIds: rule.ticketTypeIds.length === 0 ? [] : here,
        label: describePromo(rule),
      };
    },

    /** The order page read model (A4). @throws OrderNotFoundError */
    async getOrder(id: string): Promise<OrderView> {
      const order = await orders.findById(id);
      if (!order) throw new OrderNotFoundError(id);
      const [event, ticketType, auditEvents, ticketRows, promo] = await Promise.all([
        events.findById(order.eventId),
        ticketTypes.findById(order.ticketTypeId),
        orders.listEvents(order.id),
        tickets.listByOrder(order.id),
        order.promoCodeId ? promoCodes.findById(order.promoCodeId) : null,
      ]);
      // FKs guarantee these; a miss is corruption, not a 404.
      if (!event) throw new Error(`order ${id}: event ${order.eventId} missing`);
      if (!ticketType) throw new Error(`order ${id}: ticket type ${order.ticketTypeId} missing`);
      return {
        order,
        event,
        ticketType,
        events: auditEvents,
        tickets: ticketRows,
        promoCode: promo?.code ?? null,
      };
    },

    /** B7: what is waiting for a person, oldest first. */
    async listVerificationQueue(): Promise<QueueEntry[]> {
      const rows = await orders.listVerificationQueue();
      // updated_at is the submission time: the trxID write is the last one
      // an order in this status has had.
      return rows.map((r) => ({ ...r, submittedAt: r.order.updatedAt }));
    },

    countPendingVerification(): Promise<number> {
      return orders.countByStatus('pending_verification');
    },

    /**
     * "Find my order" without an account: the reference plus the phone used
     * at registration (E.164, normalised at the boundary). Null on any
     * mismatch — the page says one generic thing either way.
     */
    async findByReferenceAndPhone(reference: string, phone: string): Promise<OrderRecord | null> {
      const order = await orders.findByReference(reference.trim().toUpperCase());
      if (!order || order.buyerPhone !== phone) return null;
      return order;
    },

    /** "My orders" for a signed-in buyer: proof of the email is the access rule. */
    listForBuyer(email: string): Promise<QueueRow[]> {
      return orders.listByBuyerEmail(email.trim().toLowerCase());
    },

    /**
     * B9: one page of the orders list. Dates are Dhaka calendar days — the
     * "to" day is included whole (exclusive bound = the next midnight).
     * The page number clamps to the last page so a stale link never shows
     * an empty table with a total that says otherwise.
     */
    async searchOrders(input: OrdersSearchInput): Promise<OrdersSearchResult> {
      const filter = toSearchFilter(input);
      const size = input.size ?? ORDERS_PAGE_SIZE;
      const first = await orders.search(
        filter,
        { limit: size, offset: (input.page - 1) * size },
        input.sort,
      );
      const pages = Math.max(1, Math.ceil(first.total / size));
      const page = Math.min(input.page, pages);
      const result =
        page === input.page
          ? first
          : await orders.search(filter, { limit: size, offset: (page - 1) * size }, input.sort);
      return {
        rows: result.rows.map((row) => ({ ...row, matchedField: matchedField(row, filter.term) })),
        total: result.total,
        page,
        pageSize: size,
        pages,
      };
    },

    /** The same filter without pagination, for the CSV. Capped; the caller says so in the file. */
    async exportOrders(input: OrdersSearchInput): Promise<OrdersSearchPage> {
      return orders.search(
        toSearchFilter(input),
        { limit: ORDERS_EXPORT_CAP, offset: 0 },
        input.sort,
      );
    },

    /** B9 status strip for the current event/date/term filter (status itself ignored). */
    async orderTotals(input: OrdersSearchInput): Promise<OrderTotals> {
      return summariseTotals(await orders.totalsByStatus(toSearchFilter(input)));
    },

    /**
     * The buyer reports a bKash payment. First submission moves the order to
     * `pending_verification`; a later one only corrects the trxID/number
     * (design A4 "Edit transaction ID"). Uniqueness of the trxID is the
     * database's (Invariant 3): the UNIQUE index surfaces as
     * TrxIdAlreadyUsedError, and the transaction — including the audit
     * row — rolls back with it.
     * @throws OrderNotFoundError, OrderStatusConflictError, TrxIdAlreadyUsedError
     */
    async submitPayment(orderId: string, input: SubmitPaymentInput): Promise<OrderRecord> {
      // Stored normalised (Invariant 3) whoever the caller is — the UNIQUE
      // index compares bytes, so "9ab…" and "9AB…" must never both exist.
      const trxId = input.trxId.trim().toUpperCase();

      return runInTransaction(async (tx) => {
        // Read under the row lock so the audit row's from-status and the
        // "previous trxID" are what was actually replaced, even when two
        // tabs submit at once (Invariant 6 must never lie).
        const order = await orders.findByIdForUpdate(orderId, tx);
        if (!order) throw new OrderNotFoundError(orderId);
        if (!SUBMITTABLE.includes(order.status as (typeof SUBMITTABLE)[number])) {
          throw new OrderStatusConflictError(orderId, order.status);
        }
        const fromStatus = order.status;
        const first = fromStatus === 'pending_payment';
        if (first) assertOrderTransition(fromStatus, 'pending_verification');

        const updated = await orders.transition(
          orderId,
          {
            from: SUBMITTABLE,
            to: 'pending_verification',
            patch: { bkashTrxId: trxId, bkashSenderMsisdn: input.senderMsisdn },
          },
          tx,
        );
        // Locked and re-checked above, so this cannot miss; kept as the
        // backstop the conditional write is for.
        if (!updated) throw new OrderStatusConflictError(orderId, fromStatus);

        await orders.insertEvent(
          {
            orderId,
            actor: 'buyer',
            action: first ? 'payment.submitted' : 'payment.updated',
            fromStatus,
            toStatus: 'pending_verification',
            note: first
              ? `trxID ${trxId} from ${input.senderMsisdn}`
              : `trxID ${order.bkashTrxId ?? '—'} → ${trxId} from ${input.senderMsisdn}`,
          },
          tx,
        );
        return updated;
      });
    },

    /**
     * The 24-hour expiry (ADR-002, ADR-012): only `pending_payment` orders
     * lapse — once a trxID exists, a person decides. Per order, one
     * transaction: flip the status conditionally, and only if that matched,
     * release the hold and write the audit row. A second run, or a second
     * worker, can never release the same hold twice.
     */
    async expireLapsedHolds(at: Date = now()): Promise<{ expired: number; failed: number }> {
      const lapsed = await orders.listLapsedHolds(at, EXPIRY_BATCH);
      let expired = 0;
      let failed = 0;
      for (const hold of lapsed) {
        // One order's failure (e.g. a corrupted counter) must never block
        // the rest: it is logged and skipped, and the run reports it.
        try {
          const done = await runInTransaction(async (tx) => {
            const updated = await orders.transition(
              hold.id,
              { from: ['pending_payment'], to: 'expired' },
              tx,
            );
            if (!updated) return false; // submitted (or expired) in the meantime
            await inventory.release(hold.ticketTypeId, hold.quantity, tx);
            await orders.insertEvent(
              {
                orderId: hold.id,
                actor: 'system',
                action: 'order.expired',
                fromStatus: 'pending_payment',
                toStatus: 'expired',
                note: `24h hold lapsed; ${hold.quantity} released`,
              },
              tx,
            );
            return true;
          });
          if (done) {
            expired++;
            logger.info(
              { orderId: hold.id, quantity: hold.quantity },
              'order expired, hold released',
            );
            await afterCommit(() => onOrderExpired(hold.id), 'onOrderExpired', hold.id);
          }
        } catch (err: unknown) {
          failed++;
          logger.error({ orderId: hold.id, err }, 'expire-holds: order skipped');
        }
      }
      return { expired, failed };
    },
  };
}

export type OrdersService = ReturnType<typeof createOrdersService>;
