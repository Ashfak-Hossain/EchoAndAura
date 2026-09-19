import { addHours } from 'date-fns';
import type { DbExecutor } from '@/db/executor';
import {
  AttendeeNamesMismatchError,
  OrderNotFoundError,
  OrderReferenceCollisionError,
  RegistrationClosedError,
  SoldOutError,
  TicketTypeNotFoundError,
  TicketTypeNotOnSaleError,
  EventNotFoundError,
} from '@/server/lib/errors';
import { eventPhase } from '@/server/lib/event-phase';
import { generateOrderReference } from '@/server/lib/order-reference';
import { computeOrderTotals } from '@/server/lib/pricing';
import { ticketTypeSaleState } from '@/server/lib/ticket-type-sale-state';
import type { EventRecord, EventsRepository } from '@/server/repositories/events.repository';
import type { OrderRecord, OrdersRepository } from '@/server/repositories/orders.repository';
import type {
  TicketTypeRecord,
  TicketTypesRepository,
} from '@/server/repositories/ticket-types.repository';
import type { InventoryService } from '@/server/services/inventory.service';

/** Inventory is held this long from order creation (ADR-002). */
export const HOLD_HOURS = 24;

/** How many fresh references to try before giving up on a collision. */
const REFERENCE_ATTEMPTS = 3;

export interface OrdersServiceDeps {
  orders: OrdersRepository;
  events: EventsRepository;
  ticketTypes: TicketTypesRepository;
  inventory: InventoryService;
  /**
   * Opens a database transaction and runs `fn` inside it — injected so this
   * module never imports the client. Everything inside must be a database
   * write (Invariant 7: no HTTP in a transaction).
   */
  runInTransaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  now?: () => Date;
  reference?: () => string;
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
}

export interface OrderView {
  order: OrderRecord;
  event: EventRecord;
  ticketType: TicketTypeRecord;
}

/**
 * Order creation (Phase 3). Reads happen before the transaction; the
 * transaction holds exactly three statements — hold, insert order, insert
 * audit row — so the row lock on ticket_types is held for microseconds and
 * a failure anywhere leaves no orphaned hold.
 */
export function createOrdersService({
  orders,
  events,
  ticketTypes,
  inventory,
  runInTransaction,
  now = () => new Date(),
  reference = generateOrderReference,
}: OrdersServiceDeps) {
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

      // 3. Money, from the row, never from the client.
      const totals = computeOrderTotals({
        unitPricePaisa: ticketType.pricePaisa,
        quantity: input.quantity,
      });

      // 4. Hold + order + audit row, atomically. Sold-out is thrown *inside*
      //    the callback so the transaction rolls back with nothing written.
      for (let attempt = 1; ; attempt++) {
        const ref = reference();
        try {
          return await runInTransaction(async (tx) => {
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
                note: `${totals.quantity} × ${ticketType.name}, hold until ${order.holdExpiresAt?.toISOString()}`,
              },
              tx,
            );

            return order;
          });
        } catch (err: unknown) {
          // The transaction rolled back (hold included); a fresh reference
          // is all that is needed. Anything else propagates.
          if (err instanceof OrderReferenceCollisionError && attempt < REFERENCE_ATTEMPTS) continue;
          throw err;
        }
      }
    },

    /** The order page read model (A4). @throws OrderNotFoundError */
    async getOrder(id: string): Promise<OrderView> {
      const order = await orders.findById(id);
      if (!order) throw new OrderNotFoundError(id);
      const [event, ticketType] = await Promise.all([
        events.findById(order.eventId),
        ticketTypes.findById(order.ticketTypeId),
      ]);
      // FKs guarantee these; a miss is corruption, not a 404.
      if (!event) throw new Error(`order ${id}: event ${order.eventId} missing`);
      if (!ticketType) throw new Error(`order ${id}: ticket type ${order.ticketTypeId} missing`);
      return { order, event, ticketType };
    },
  };
}

export type OrdersService = ReturnType<typeof createOrdersService>;
