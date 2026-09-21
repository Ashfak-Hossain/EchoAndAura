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
    public readonly operation: 'release' | 'convertToSold' | 'releaseSold',
  ) {
    super(
      `Inventory ${operation} on ticket type ${ticketTypeId} exceeds what is ${
        operation === 'releaseSold' ? 'sold' : 'held'
      }`,
    );
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

/** The order state machine forbids this move (see order-status.ts). */
export class InvalidOrderTransitionError extends DomainError {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Cannot change order status from "${from}" to "${to}"`);
  }
}

/** Registration for this event is not open right now; `phase` says why. */
export class RegistrationClosedError extends DomainError {
  constructor(public readonly phase: string) {
    super(`Registration is not open (${phase})`);
  }
}

/** The ticket type is not selling right now; `state` says why. */
export class TicketTypeNotOnSaleError extends DomainError {
  constructor(
    public readonly ticketTypeId: string,
    public readonly state: string,
  ) {
    super(`Ticket type ${ticketTypeId} is not on sale (${state})`);
  }
}

export class OrderNotFoundError extends DomainError {
  constructor(public readonly orderId: string) {
    super(`Order ${orderId} not found`);
  }
}

/** A freshly generated order reference already exists — the caller retries. */
export class OrderReferenceCollisionError extends DomainError {
  constructor(public readonly reference: string) {
    super(`Order reference ${reference} is already taken`);
  }
}

/** One attendee name per ticket, always — whoever calls the service. */
export class AttendeeNamesMismatchError extends DomainError {
  constructor(
    public readonly quantity: number,
    public readonly names: number,
  ) {
    super(`Expected ${quantity} attendee names, got ${names}`);
  }
}

/**
 * The bKash transaction ID is already on another order. Enforced by the
 * UNIQUE index on orders.bkash_trx_id (Invariant 3) — never by a lookup.
 */
export class TrxIdAlreadyUsedError extends DomainError {
  constructor(public readonly trxId: string) {
    super(`Transaction ID ${trxId} has already been used`);
  }
}

/**
 * The conditional status UPDATE matched no row: the order's status changed
 * since it was read (expired by the job, submitted from another tab, or
 * acted on by an admin). The caller reloads and shows the real state.
 */
export class OrderStatusConflictError extends DomainError {
  constructor(
    public readonly orderId: string,
    public readonly status: string,
  ) {
    super(`Order ${orderId} is ${status}; this action no longer applies`);
  }
}

/** A freshly generated ticket code already exists — the caller retries. */
export class TicketCodeCollisionError extends DomainError {
  constructor(public readonly code: string) {
    super(`Ticket code ${code} is already taken`);
  }
}

/** The rejection reason is not one of the fixed list (rejection-reasons.ts). */
export class InvalidRejectionReasonError extends DomainError {
  constructor(public readonly reason: string) {
    super(`Unknown rejection reason "${reason}"`);
  }
}

/**
 * The trxID on the order is not the one the admin verified: the buyer
 * edited it after the page was opened. What was checked against the
 * statement is not what would be approved — the admin must look again.
 */
export class TrxIdChangedError extends DomainError {
  constructor(
    public readonly orderId: string,
    public readonly verified: string,
    public readonly current: string | null,
  ) {
    super(
      `Order ${orderId}: verified trxID ${verified} but the order now carries ${current ?? '—'}`,
    );
  }
}

/** `ref` is whatever the caller looked the ticket up by: a code, or an id on the admin side. */
export class TicketNotFoundError extends DomainError {
  constructor(public readonly ref: string) {
    super(`Ticket ${ref} not found`);
  }
}

/** A cancelled ticket cannot be renamed or cancelled again — it will not be admitted anyway. */
export class TicketCancelledError extends DomainError {
  constructor(public readonly code: string) {
    super(`Ticket ${code} is cancelled`);
  }
}

/** Names lock when registration closes: the door list is printed from then on. */
export class RenameLockedError extends DomainError {
  constructor(public readonly lockedAt: Date | null) {
    super(`Attendee names are locked${lockedAt ? ` since ${lockedAt.toISOString()}` : ''}`);
  }
}

/** The attendee name fails the shared rule in attendee-name.ts. */
export class InvalidAttendeeNameError extends DomainError {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

/** The ticket changed (renamed or cancelled) between the page load and the save. */
export class TicketRenameConflictError extends DomainError {
  constructor(public readonly code: string) {
    super(`Ticket ${code} changed before the rename could be saved`);
  }
}
