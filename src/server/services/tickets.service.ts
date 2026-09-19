import type { DbExecutor } from '@/db/executor';
import { normaliseAttendeeName } from '@/server/lib/attendee-name';
import {
  InvalidAttendeeNameError,
  RenameLockedError,
  TicketCancelledError,
  TicketNotFoundError,
  TicketRenameConflictError,
} from '@/server/lib/errors';
import type { EventRecord, EventsRepository } from '@/server/repositories/events.repository';
import type { OrderRecord, OrdersRepository } from '@/server/repositories/orders.repository';
import type {
  TicketTypeRecord,
  TicketTypesRepository,
} from '@/server/repositories/ticket-types.repository';
import type { TicketRecord, TicketsRepository } from '@/server/repositories/tickets.repository';

/**
 * The buyer-facing ticket (A5). The ticket code is the access key: the page
 * shows the attendee, the event and the code, never the buyer's contact
 * details. Business rule: the attendee name is editable until registration
 * closes, when the door list is printed and fixed.
 */
export interface TicketsServiceDeps {
  tickets: TicketsRepository;
  orders: OrdersRepository;
  events: EventsRepository;
  ticketTypes: TicketTypesRepository;
  runInTransaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  now?: () => Date;
}

export interface TicketView {
  ticket: TicketRecord;
  /** Reference and quantity only — the order's PII stays on the order page. */
  order: Pick<OrderRecord, 'id' | 'reference' | 'quantity'>;
  event: EventRecord;
  ticketType: TicketTypeRecord;
  /** 1-based position within the order, for "ticket 1 of 3". */
  position: number;
  /** All the order's tickets, in order (for the multi-page PDF). */
  siblings: TicketRecord[];
  canRename: boolean;
  /** When names locked (registration close), or null if no close is set. */
  renameLockedAt: Date | null;
}

/** Codes are typed and read aloud: normalise before lookup. */
export function normaliseTicketCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function createTicketsService({
  tickets,
  orders,
  events,
  ticketTypes,
  runInTransaction,
  now = () => new Date(),
}: TicketsServiceDeps) {
  function renameWindow(event: EventRecord, at: Date): { open: boolean; lockedAt: Date | null } {
    const closes = event.registrationClosesAt;
    // No close date means the event was never publishable; be safe and lock.
    if (!closes) return { open: false, lockedAt: null };
    return { open: at.getTime() < closes.getTime(), lockedAt: closes };
  }

  return {
    /** @throws TicketNotFoundError */
    async getTicketByCode(rawCode: string): Promise<TicketView> {
      const code = normaliseTicketCode(rawCode);
      const ticket = await tickets.findByCode(code);
      if (!ticket) throw new TicketNotFoundError(code);
      const [order, event, ticketType, siblings] = await Promise.all([
        orders.findById(ticket.orderId),
        events.findById(ticket.eventId),
        ticketTypes.findById(ticket.ticketTypeId),
        tickets.listByOrder(ticket.orderId),
      ]);
      // FKs guarantee these; a miss is corruption, not a 404.
      if (!order) throw new Error(`ticket ${code}: order ${ticket.orderId} missing`);
      if (!event) throw new Error(`ticket ${code}: event ${ticket.eventId} missing`);
      if (!ticketType)
        throw new Error(`ticket ${code}: ticket type ${ticket.ticketTypeId} missing`);

      const window = renameWindow(event, now());
      return {
        ticket,
        order: { id: order.id, reference: order.reference, quantity: order.quantity },
        event,
        ticketType,
        position: ticket.position,
        siblings,
        canRename: ticket.status === 'issued' && window.open,
        renameLockedAt: window.lockedAt,
      };
    },

    /**
     * Change the name on a ticket. Allowed while the ticket is issued and
     * registration is still open; the ticket code never changes.
     * @throws TicketNotFoundError, TicketCancelledError, RenameLockedError,
     *   InvalidAttendeeNameError, TicketRenameConflictError
     */
    async renameAttendee(rawCode: string, rawName: string): Promise<TicketRecord> {
      const code = normaliseTicketCode(rawCode);
      const name = normaliseAttendeeName(rawName);
      if (!name)
        throw new InvalidAttendeeNameError('Enter the name the guest will give at the door.');

      const ticket = await tickets.findByCode(code);
      if (!ticket) throw new TicketNotFoundError(code);
      if (ticket.status === 'cancelled') throw new TicketCancelledError(code);
      const event = await events.findById(ticket.eventId);
      if (!event) throw new Error(`ticket ${code}: event ${ticket.eventId} missing`);
      const window = renameWindow(event, now());
      if (!window.open) throw new RenameLockedError(window.lockedAt);

      return runInTransaction(async (tx) => {
        // Compare-and-swap on status AND the old name: a cancel or another
        // rename landing in between wins, and the audit row never lies.
        const updated = await tickets.updateAttendeeName(ticket.id, ticket.attendeeName, name, tx);
        if (!updated) throw new TicketRenameConflictError(code);
        // Not a status change, but "who renamed this ticket" is a question
        // Raj will ask at the door.
        await orders.insertEvent(
          {
            orderId: ticket.orderId,
            actor: 'buyer',
            action: 'ticket.renamed',
            fromStatus: null,
            toStatus: null,
            note: `${code}: ${ticket.attendeeName} → ${name}`,
          },
          tx,
        );
        return updated;
      });
    },
  };
}

export type TicketsService = ReturnType<typeof createTicketsService>;
