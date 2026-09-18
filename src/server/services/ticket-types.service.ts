import { TicketTypeInUseError, TicketTypeNotFoundError } from '@/server/lib/errors';
import type {
  TicketTypeRecord,
  TicketTypesRepository,
} from '@/server/repositories/ticket-types.repository';

/**
 * Ticket-type business rules for the admin side. Prices arrive already in
 * integer paisa (converted at the form boundary by money.ts) and are stored
 * untouched. Capacity floors are the database's job — see the repository.
 */

export interface TicketTypeInput {
  name: string;
  /** Integer paisa (Invariant 1). */
  pricePaisa: number;
  quantityTotal: number;
  /** Optional sales window — how "Early Bird" is expressed. */
  salesStartsAt?: Date;
  salesEndsAt?: Date;
}

export function createTicketTypesService(repo: TicketTypesRepository) {
  return {
    listForEvent(eventId: string): Promise<TicketTypeRecord[]> {
      return repo.listByEvent(eventId);
    },

    async getTicketType(id: string): Promise<TicketTypeRecord> {
      const ticketType = await repo.findById(id);
      if (!ticketType) throw new TicketTypeNotFoundError(id);
      return ticketType;
    },

    /** @throws EventNotFoundError (from the repository) when the event is gone. */
    createTicketType(eventId: string, input: TicketTypeInput): Promise<TicketTypeRecord> {
      return repo.insert({
        eventId,
        name: input.name,
        pricePaisa: input.pricePaisa,
        quantityTotal: input.quantityTotal,
        salesStartsAt: input.salesStartsAt ?? null,
        salesEndsAt: input.salesEndsAt ?? null,
      });
    },

    /**
     * Full-form update. quantity_sold / quantity_reserved are never part of
     * the patch; if the new total undercuts them the repository raises
     * TicketTypeCapacityTooLowError from the CHECK constraint.
     * @throws TicketTypeNotFoundError, TicketTypeCapacityTooLowError
     */
    async updateTicketType(id: string, input: TicketTypeInput): Promise<TicketTypeRecord> {
      const updated = await repo.update(id, {
        name: input.name,
        pricePaisa: input.pricePaisa,
        quantityTotal: input.quantityTotal,
        salesStartsAt: input.salesStartsAt ?? null,
        salesEndsAt: input.salesEndsAt ?? null,
      });
      if (!updated) throw new TicketTypeNotFoundError(id);
      return updated;
    },

    /**
     * Deleting is only allowed while nothing is sold or held — a clear
     * refusal here, and the orders/tickets FKs backstop any history we can't
     * see from the counters (e.g. rejected orders).
     * @throws TicketTypeNotFoundError, TicketTypeInUseError
     */
    async deleteTicketType(id: string): Promise<void> {
      const ticketType = await repo.findById(id);
      if (!ticketType) throw new TicketTypeNotFoundError(id);
      if (ticketType.quantitySold > 0 || ticketType.quantityReserved > 0) {
        throw new TicketTypeInUseError(id);
      }
      const deleted = await repo.delete(id);
      if (!deleted) throw new TicketTypeNotFoundError(id);
    },
  };
}

export type TicketTypesService = ReturnType<typeof createTicketTypesService>;
