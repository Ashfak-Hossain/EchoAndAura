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
