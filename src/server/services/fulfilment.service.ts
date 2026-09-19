import type { DbExecutor } from '@/db/executor';
import {
  AttendeeNamesMismatchError,
  InvalidRejectionReasonError,
  OrderNotFoundError,
  OrderStatusConflictError,
  TicketCodeCollisionError,
  TrxIdChangedError,
} from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import { assertOrderTransition } from '@/server/lib/order-status';
import {
  REJECTION_REASONS,
  type RejectionReason,
  isRejectionReason,
} from '@/server/lib/rejection-reasons';
import { generateTicketCode } from '@/server/lib/ticket-code';
import type { OrderRecord, OrdersRepository } from '@/server/repositories/orders.repository';
import type { TicketRecord, TicketsRepository } from '@/server/repositories/tickets.repository';
import type { InventoryService } from '@/server/services/inventory.service';

/**
 * FULFILMENT (Invariant 4). This module is the ONLY code that marks an
 * order `paid` or `issued`, the only caller of `inventory.convertToSold`,
 * and the only creator of ticket rows. It is called from the admin
 * Approve action and nowhere else. Never duplicate this logic.
 *
 * Approve is one transaction: lock the order → `paid` → held → sold →
 * ticket rows → `issued`, with an audit row per status change (Invariant
 * 6). Nothing inside it touches the network (Invariant 7); the ticket
 * email is handed to `onTicketsIssued` only after the commit.
 */

/** How many fresh code sets to try before giving up on a collision. */
const CODE_ATTEMPTS = 3;

export interface FulfilmentDeps {
  orders: OrdersRepository;
  tickets: TicketsRepository;
  inventory: InventoryService;
  runInTransaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  /**
   * Called after the approve transaction has committed — the seam for the
   * ticket email job (Phase 4, email slice). Must never throw into the
   * caller: tickets are issued whether or not the email can be queued.
   */
  onTicketsIssued: (orderId: string) => Promise<void>;
  ticketCode?: () => string;
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

export function createFulfilmentService({
  orders,
  tickets,
  inventory,
  runInTransaction,
  onTicketsIssued,
  ticketCode = generateTicketCode,
}: FulfilmentDeps) {
  return {
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

      return runInTransaction(async (tx) => {
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
    },
  };
}

export type FulfilmentService = ReturnType<typeof createFulfilmentService>;
