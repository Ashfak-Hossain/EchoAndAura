/**
 * Typed domain errors thrown by services. The app layer (server actions,
 * route handlers) catches these by class and maps them to user-facing
 * messages; anything else is an infrastructure failure and is surfaced
 * generically, never disguised as a domain problem.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class EventSlugTakenError extends DomainError {
  constructor(public readonly slug: string) {
    super(`An event with slug "${slug}" already exists`);
  }
}

export class EventNotFoundError extends DomainError {
  constructor(public readonly eventId: string) {
    super(`Event ${eventId} not found`);
  }
}

/** The event state machine forbids this move (see event-status.ts). */
export class InvalidEventTransitionError extends DomainError {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Cannot change event status from "${from}" to "${to}"`);
  }
}

/** Publishing was refused by the readiness check; `problems` lists why. */
export class EventNotPublishableError extends DomainError {
  constructor(public readonly problems: readonly string[]) {
    super(`Event is not ready to publish: ${problems.join('; ')}`);
  }
}

/**
 * The conditional status UPDATE matched no row: the event's status changed
 * since it was read (another admin tab), or the event is gone.
 */
export class EventStatusConflictError extends DomainError {
  constructor(public readonly eventId: string) {
    super(`Event ${eventId} status changed concurrently; reload and try again`);
  }
}

/** The file's type or size is not acceptable as an event cover image. */
export class CoverImageInvalidError extends DomainError {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

/** The key does not belong to this event, or no object was uploaded for it. */
export class CoverImageNotUploadedError extends DomainError {
  constructor(public readonly key: string) {
    super(`No valid uploaded cover image at "${key}"`);
  }
}

export class TicketTypeNotFoundError extends DomainError {
  constructor(public readonly ticketTypeId: string) {
    super(`Ticket type ${ticketTypeId} not found`);
  }
}

/**
 * quantity_total may never drop below quantity_sold + quantity_reserved.
 * Raised when the ticket_types availability CHECK rejects an update.
 */
export class TicketTypeCapacityTooLowError extends DomainError {
  constructor(public readonly ticketTypeId: string) {
    super(`Ticket type ${ticketTypeId} capacity cannot go below tickets already sold or held`);
  }
}

/** A ticket type with sales, holds, or any order history cannot be deleted. */
export class TicketTypeInUseError extends DomainError {
  constructor(public readonly ticketTypeId: string) {
    super(`Ticket type ${ticketTypeId} has orders and cannot be deleted`);
  }
}

/** Order quantity must be an integer from 1 to MAX_TICKETS_PER_ORDER. */
export class InvalidQuantityError extends DomainError {
  constructor(public readonly quantity: number) {
    super(`Invalid ticket quantity: ${quantity}`);
  }
}

/**
 * An inventory counter would have gone inconsistent — releasing or selling
 * more than is held. The conditional UPDATE matched no row (or the CHECK
 * constraint refused it). This is a bug or a double-processed order, never
 * a buyer-facing condition.
 */
export class InventoryStateError extends DomainError {
  constructor(
    public readonly ticketTypeId: string,
    public readonly operation: 'release' | 'convertToSold',
  ) {
    super(`Inventory ${operation} on ticket type ${ticketTypeId} exceeds what is held`);
  }
}

/**
 * The hold could not be placed: fewer tickets are available than asked for.
 * Thrown *inside* the order-creation transaction so the order insert rolls
 * back with it; the boundary maps it to the sold-out outcome for the buyer.
 */
export class SoldOutError extends DomainError {
  constructor(
    public readonly ticketTypeId: string,
    public readonly requested: number,
  ) {
    super(`Ticket type ${ticketTypeId} has fewer than ${requested} tickets available`);
  }
}
