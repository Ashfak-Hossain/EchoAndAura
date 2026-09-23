import type { DbExecutor } from '@/db/executor';
import {
  AttendeeNamesMismatchError,
  InvalidRejectionReasonError,
  OrderNotFoundError,
  OrderReferenceCollisionError,
  OrderStatusConflictError,
  SoldOutError,
  TicketCancelledError,
  TicketCodeCollisionError,
  TicketNotFoundError,
  TicketTypeNotFoundError,
  TrxIdChangedError,
} from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import { multiplyPaisa } from '@/server/lib/money';
import { generateOrderReference } from '@/server/lib/order-reference';
import { assertOrderTransition } from '@/server/lib/order-status';
import { computeOrderTotals } from '@/server/lib/pricing';
import {
  REJECTION_REASONS,
  type RejectionReason,
  isRejectionReason,
} from '@/server/lib/rejection-reasons';
import { generateTicketCode } from '@/server/lib/ticket-code';
import type { OrderRecord, OrdersRepository } from '@/server/repositories/orders.repository';
import type { TicketTypesRepository } from '@/server/repositories/ticket-types.repository';
import type { TicketRecord, TicketsRepository } from '@/server/repositories/tickets.repository';
import type { InventoryService } from '@/server/services/inventory.service';

/**
 * FULFILMENT (Invariant 4). This module is the ONLY code that marks an
 * order `paid` or `issued`, the only caller of `inventory.convertToSold`,
 * and the only creator of ticket rows. Two entry points, both admin
 * actions: Approve (a verified bKash payment) and Issue complimentary
 * tickets (B13). Never duplicate this logic elsewhere.
 *
 * Approve is one transaction: lock the order → `paid` → held → sold →
 * ticket rows → `issued`, with an audit row per status change (Invariant
 * 6). A comp is one transaction too: hold → sold → order row born `issued`
 * → ticket rows → one audit row. Nothing inside either touches the network
 * (Invariant 7); the ticket email is handed to `onTicketsIssued` only after
 * the commit.
 */

/** How many fresh code sets (and, for comps, references) to try on a collision. */
const CODE_ATTEMPTS = 3;

export interface FulfilmentDeps {
  orders: OrdersRepository;
  tickets: TicketsRepository;
  ticketTypes: TicketTypesRepository;
  inventory: InventoryService;
  runInTransaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  /**
   * Called after the approve transaction has committed — the seam for the
   * ticket email job (Phase 4, email slice). Must never throw into the
   * caller: tickets are issued whether or not the email can be queued.
   */
  onTicketsIssued: (orderId: string) => Promise<void>;
  /** Same contract, for the rejection email (C3). */
  onOrderRejected?: (orderId: string) => Promise<void>;
  /** B8 Re-send: enqueue C2 again. Unlike the others, a failure here is the caller's to report. */
  onTicketsResendRequested?: (orderId: string) => Promise<void>;
  ticketCode?: () => string;
  orderReference?: () => string;
}

export interface ComplimentaryInput {
  /** The event the admin issued from — the ticket type must be this event's. */
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  /** One name for every ticket; each can be renamed on its ticket page. */
  guestName: string;
  /** Where the tickets email goes. */
  guestEmail: string;
  /** Why — kept on the order and in the audit trail, never shown to the guest. */
  reason: string;
  /** The admin's identity for the audit row (their email). */
  actor: string;
}

export interface ApproveInput {
  /** The admin's identity for the audit row (their email). */
  actor: string;
  /** The trxID the admin compared against the statement (from the page they approved on). */
  verifiedTrxId: string;
}

export interface ApproveResult {
  order: OrderRecord;
  tickets: TicketRecord[];
}

export interface RejectInput {
  /** The admin's identity for the audit row (their email). */
  actor: string;
  reason: RejectionReason;
  /** Shown to the buyer word for word. */
  note?: string;
}

export interface CancelTicketInput {
  /** The order the page showed the ticket on — a mismatch is refused. */
  orderId: string;
  /** The admin's identity for the audit row (their email). */
  actor: string;
  /** Why — free text, kept in the audit trail (already trimmed and bounded at the boundary). */
  reason: string;
}

export interface CancelTicketResult {
  ticket: TicketRecord;
  order: OrderRecord;
  /** True when this was the order's last live ticket and the order is now `cancelled`. */
  orderCancelled: boolean;
}

export function createFulfilmentService({
  orders,
  tickets,
  ticketTypes,
  inventory,
  runInTransaction,
  onTicketsIssued,
  onOrderRejected = async () => {},
  onTicketsResendRequested = async () => {},
  ticketCode = generateTicketCode,
  orderReference = generateOrderReference,
}: FulfilmentDeps) {
  return {
    /**
     * B13: issue free tickets. They take real stock (the same atomic hold
     * every order takes — Invariant 2), are born `issued` with a ৳0 order
     * whose whole subtotal is the discount, and are cancelled ticket by
     * ticket like any other. No sales-window check: comps are the
     * organizer's call; stock is the only limit.
     * @throws TicketTypeNotFoundError (unknown, or another event's),
     *   SoldOutError, InvalidQuantityError, AttendeeNamesMismatchError
     */
    async issueComplimentaryTickets(input: ComplimentaryInput): Promise<ApproveResult> {
      const ticketType = await ticketTypes.findById(input.ticketTypeId);
      if (!ticketType || ticketType.eventId !== input.eventId) {
        throw new TicketTypeNotFoundError(input.ticketTypeId);
      }
      // The price is the row's (Invariant 5), snapshotted like any order's;
      // the discount is all of it, so the total is 0 by the one pricing rule.
      const totals = computeOrderTotals({
        unitPricePaisa: ticketType.pricePaisa,
        quantity: input.quantity,
        discountPaisa: multiplyPaisa(ticketType.pricePaisa, input.quantity),
      });
      const names = Array.from({ length: input.quantity }, () => input.guestName);

      for (let attempt = 1; ; attempt++) {
        try {
          const result = await runInTransaction(async (tx) => {
            // Held, then straight to sold: comps compete for the last seats
            // exactly like paid orders do, through the same conditional UPDATEs.
            const held = await inventory.hold(ticketType.id, input.quantity, tx);
            if (!held) throw new SoldOutError(ticketType.id, input.quantity);
            await inventory.convertToSold(ticketType.id, input.quantity, tx);

            // Born `issued`: there is no payment step to pass through, the
            // same way createOrder inserts at `pending_payment`.
            const order = await orders.insert(
              {
                reference: orderReference(),
                eventId: ticketType.eventId,
                ticketTypeId: ticketType.id,
                quantity: totals.quantity,
                unitPricePaisa: totals.unitPricePaisa,
                subtotalPaisa: totals.subtotalPaisa,
                discountPaisa: totals.discountPaisa,
                totalPaisa: totals.totalPaisa,
                status: 'issued',
                buyerName: input.guestName,
                buyerEmail: input.guestEmail,
                buyerPhone: null,
                attendeeNames: names,
                complimentaryReason: input.reason,
                holdExpiresAt: null,
              },
              tx,
            );
            if (order.attendeeNames.length !== order.quantity) {
              throw new AttendeeNamesMismatchError(order.quantity, order.attendeeNames.length);
            }

            const rows = await tickets.insertMany(
              order.attendeeNames.map((attendeeName, i) => ({
                orderId: order.id,
                ticketTypeId: order.ticketTypeId,
                eventId: order.eventId,
                code: ticketCode(),
                position: i + 1,
                attendeeName,
                status: 'issued' as const,
              })),
              tx,
            );

            // One change (nothing → issued), one audit row (Invariant 6).
            await orders.insertEvent(
              {
                orderId: order.id,
                actor: input.actor,
                action: 'order.comp_issued',
                fromStatus: null,
                toStatus: 'issued',
                note: `${order.quantity} × ${ticketType.name} · complimentary — ${input.reason} · ${rows
                  .map((t) => t.code)
                  .join(', ')}`,
              },
              tx,
            );
            return { order, tickets: rows };
          });

          try {
            await onTicketsIssued(result.order.id);
          } catch (err: unknown) {
            logger.error({ orderId: result.order.id, err }, 'fulfilment: onTicketsIssued failed');
          }
          return result;
        } catch (err: unknown) {
          // Rolled back whole (hold included): a fresh reference and codes are all that is needed.
          const collision =
            err instanceof TicketCodeCollisionError || err instanceof OrderReferenceCollisionError;
          if (collision && attempt < CODE_ATTEMPTS) continue;
          throw err;
        }
      }
    },

    /**
     * Approve a verified payment: the order becomes `issued`, its hold
     * becomes sales, and one ticket per attendee name exists.
     * @throws OrderNotFoundError, OrderStatusConflictError (not awaiting
     *   verification — including a concurrent approve that won),
     *   TrxIdChangedError, AttendeeNamesMismatchError, InvalidOrderTransitionError
     */
    async approveOrder(
      orderId: string,
      { actor, verifiedTrxId }: ApproveInput,
    ): Promise<ApproveResult> {
      for (let attempt = 1; ; attempt++) {
        try {
          const result = await runInTransaction(async (tx) => {
            const order = await orders.findByIdForUpdate(orderId, tx);
            if (!order) throw new OrderNotFoundError(orderId);
            if (order.status !== 'pending_verification') {
              throw new OrderStatusConflictError(orderId, order.status);
            }
            // The admin checked a specific trxID against the statement. A
            // buyer may edit it while the order is pending_verification; if
            // that happened after the page loaded, what was verified is not
            // what would be approved — and the verified id would be freed
            // for a second order. Refuse; the admin looks again.
            if (order.bkashTrxId !== verifiedTrxId) {
              throw new TrxIdChangedError(orderId, verifiedTrxId, order.bkashTrxId);
            }
            assertOrderTransition(order.status, 'paid');
            assertOrderTransition('paid', 'issued');

            // 1. Money confirmed by a person.
            const paid = await orders.transition(
              orderId,
              { from: ['pending_verification'], to: 'paid' },
              tx,
            );
            // Unreachable under the row lock; kept as the conditional write's backstop.
            if (!paid) throw new OrderStatusConflictError(orderId, order.status);
            await orders.insertEvent(
              {
                orderId,
                actor,
                action: 'payment.approved',
                fromStatus: 'pending_verification',
                toStatus: 'paid',
                note: `trxID ${order.bkashTrxId ?? '—'} · ${order.totalPaisa} paisa`,
              },
              tx,
            );

            // 2. The hold becomes a sale (the one call site of convertToSold).
            await inventory.convertToSold(order.ticketTypeId, order.quantity, tx);

            // 3. One ticket per attendee name captured at registration.
            //    createOrder guarantees the count; a mismatch here is
            //    corruption or a hand edit — refuse rather than repair.
            if (order.attendeeNames.length !== order.quantity) {
              throw new AttendeeNamesMismatchError(order.quantity, order.attendeeNames.length);
            }
            const rows = await tickets.insertMany(
              order.attendeeNames.map((attendeeName, i) => ({
                orderId,
                ticketTypeId: order.ticketTypeId,
                eventId: order.eventId,
                code: ticketCode(),
                position: i + 1,
                attendeeName,
                status: 'issued' as const,
              })),
              tx,
            );

            // 4. Tickets exist → the order is issued.
            const issued = await orders.transition(orderId, { from: ['paid'], to: 'issued' }, tx);
            if (!issued) throw new OrderStatusConflictError(orderId, 'paid');
            await orders.insertEvent(
              {
                orderId,
                actor,
                action: 'tickets.issued',
                fromStatus: 'paid',
                toStatus: 'issued',
                note: rows.map((t) => t.code).join(', '),
              },
              tx,
            );

            return { order: issued, tickets: rows };
          });

          // After commit only (Invariant 7). A failure here is logged, never
          // surfaced: the tickets are real and the email can be re-sent.
          try {
            await onTicketsIssued(orderId);
          } catch (err: unknown) {
            logger.error({ orderId, err }, 'fulfilment: onTicketsIssued failed');
          }
          return result;
        } catch (err: unknown) {
          // The whole transaction rolled back; fresh codes are all that is needed.
          if (err instanceof TicketCodeCollisionError && attempt < CODE_ATTEMPTS) continue;
          throw err;
        }
      }
    },

    /**
     * Reject a payment: the hold goes back on sale and the buyer sees the
     * reason (and note) word for word.
     * @throws InvalidRejectionReasonError, OrderNotFoundError,
     *   OrderStatusConflictError, InvalidOrderTransitionError
     */
    async rejectOrder(orderId: string, { actor, reason, note }: RejectInput): Promise<OrderRecord> {
      if (!isRejectionReason(reason)) throw new InvalidRejectionReasonError(String(reason));
      const cleanNote = note?.trim() || null;

      const rejected = await runInTransaction(async (tx) => {
        const order = await orders.findByIdForUpdate(orderId, tx);
        if (!order) throw new OrderNotFoundError(orderId);
        if (order.status !== 'pending_verification') {
          throw new OrderStatusConflictError(orderId, order.status);
        }
        assertOrderTransition(order.status, 'rejected');

        const rejected = await orders.transition(
          orderId,
          {
            from: ['pending_verification'],
            to: 'rejected',
            patch: { rejectionReason: reason, rejectionNote: cleanNote },
          },
          tx,
        );
        if (!rejected) throw new OrderStatusConflictError(orderId, order.status);

        // Only after the status flip, in the same tx: never released twice.
        await inventory.release(order.ticketTypeId, order.quantity, tx);

        await orders.insertEvent(
          {
            orderId,
            actor,
            action: 'payment.rejected',
            fromStatus: 'pending_verification',
            toStatus: 'rejected',
            note: cleanNote
              ? `${REJECTION_REASONS[reason]} — ${cleanNote}`
              : REJECTION_REASONS[reason],
          },
          tx,
        );
        return rejected;
      });

      // After commit only (Invariant 7); a failed enqueue never undoes a rejection.
      try {
        await onOrderRejected(orderId);
      } catch (err: unknown) {
        logger.error({ orderId, err }, 'fulfilment: onOrderRejected failed');
      }
      return rejected;
    },

    /**
     * B8 "Cancel ticket": one seat goes back on sale; money is returned
     * outside the app. One transaction — lock the order, then the ticket
     * (the same order approve takes, so two admins cancelling siblings
     * cannot deadlock) → conditional `issued → cancelled` on the ticket →
     * ONLY THEN `inventory.releaseSold(1)`, so a lost race can never free a
     * seat twice → audit row with the reason (Invariant 6). When it was the
     * order's last live ticket the order follows (`issued → cancelled`, its
     * one legal exit) with its own audit row. Nothing here is network
     * (Invariant 7): there is no cancellation email — the admin is already
     * talking to the buyer.
     * @throws TicketNotFoundError (also when the ticket is not on `orderId`),
     *   TicketCancelledError (already cancelled, including a concurrent
     *   cancel that won), OrderNotFoundError, OrderStatusConflictError (order
     *   not `issued`), InventoryStateError
     */
    async cancelTicket(
      ticketId: string,
      { orderId, actor, reason }: CancelTicketInput,
    ): Promise<CancelTicketResult> {
      return runInTransaction(async (tx) => {
        // Lock the order first: it is the aggregate, and approve locks it too.
        const order = await orders.findByIdForUpdate(orderId, tx);
        if (!order) throw new OrderNotFoundError(orderId);
        if (order.status !== 'issued') throw new OrderStatusConflictError(orderId, order.status);

        const ticket = await tickets.findByIdForUpdate(ticketId, tx);
        // A ticket on some other order is "not found" here, never touched.
        if (!ticket || ticket.orderId !== orderId) throw new TicketNotFoundError(ticketId);
        if (ticket.status === 'cancelled') throw new TicketCancelledError(ticket.code);

        const cancelled = await tickets.cancel(ticketId, tx);
        if (!cancelled) throw new TicketCancelledError(ticket.code);

        // After the conditional flip, in the same tx: the seat was SOLD, so
        // it leaves quantity_sold — `release` would free someone else's hold.
        await inventory.releaseSold(ticket.ticketTypeId, 1, tx);

        await orders.insertEvent(
          {
            orderId,
            actor,
            action: 'ticket.cancelled',
            fromStatus: null,
            toStatus: null,
            note: `${ticket.code} (${ticket.attendeeName}): ${reason}`,
          },
          tx,
        );

        const live = await tickets.countIssuedByOrder(orderId, tx);
        if (live > 0) return { ticket: cancelled, order, orderCancelled: false };

        // Last live ticket gone: the order is over. Same tx, same audit trail.
        assertOrderTransition(order.status, 'cancelled');
        const done = await orders.transition(orderId, { from: ['issued'], to: 'cancelled' }, tx);
        if (!done) throw new OrderStatusConflictError(orderId, order.status);
        await orders.insertEvent(
          {
            orderId,
            actor,
            action: 'order.cancelled',
            fromStatus: 'issued',
            toStatus: 'cancelled',
            note: `all ${order.quantity} tickets cancelled`,
          },
          tx,
        );
        return { ticket: cancelled, order: done, orderCancelled: true };
      });
    },

    /**
     * B8 "Re-send tickets email". Who asked is recorded *before* the job
     * exists, so a queue failure leaves a truthful trail and the action can
     * say so. @throws OrderNotFoundError, OrderStatusConflictError
     */
    async resendTicketsEmail(orderId: string, actor: string): Promise<void> {
      const order = await orders.findById(orderId);
      if (!order) throw new OrderNotFoundError(orderId);
      if (order.status !== 'issued') throw new OrderStatusConflictError(orderId, order.status);
      await orders.insertEvent({
        orderId,
        actor,
        action: 'email.resend_requested',
        fromStatus: null,
        toStatus: null,
        note: 'tickets-issued',
      });
      await onTicketsResendRequested(orderId);
    },
  };
}

export type FulfilmentService = ReturnType<typeof createFulfilmentService>;
