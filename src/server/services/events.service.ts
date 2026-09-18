import {
  EventNotFoundError,
  EventNotPublishableError,
  EventStatusConflictError,
} from '@/server/lib/errors';
import { type EventStatus, assertEventTransition } from '@/server/lib/event-status';
import { type PublishProblem, publishReadiness } from '@/server/lib/publish-readiness';
import { defaultRegistrationWindow } from '@/server/lib/registration-window';
import { slugify } from '@/server/lib/slug';
import type {
  EventPatch,
  EventRecord,
  EventsRepository,
} from '@/server/repositories/events.repository';
import type { TicketTypesRepository } from '@/server/repositories/ticket-types.repository';

/**
 * Event business rules. Built by a factory that receives its repositories,
 * so this module never imports the database: unit tests pass in-memory
 * fakes and a fixed clock; `src/server/container.ts` wires the real ones.
 *
 * Events are created as `draft`. Status moves go through `changeEventStatus`
 * only: the state machine in event-status.ts decides what is legal, the
 * readiness check decides whether publishing is allowed, and the repository
 * applies the change with a conditional UPDATE.
 */

export interface EventsServiceOptions {
  /** Injectable clock for the readiness check. */
  now?: () => Date;
}

export interface CreateEventInput {
  title: string;
  /** Optional explicit URL slug; derived from the title when omitted. */
  slug?: string;
  description?: string;
  venue?: string;
  startsAt: Date;
  endsAt?: Date;
  /** Either registration bound left undefined falls back to the 20/5-day rule. */
  registrationOpensAt?: Date;
  registrationClosesAt?: Date;
}

export type UpdateEventInput = CreateEventInput;

export function createEventsService(
  repo: EventsRepository,
  ticketTypes: TicketTypesRepository,
  { now = () => new Date() }: EventsServiceOptions = {},
) {
  async function getEvent(id: string): Promise<EventRecord> {
    const event = await repo.findById(id);
    if (!event) throw new EventNotFoundError(id);
    return event;
  }

  async function readinessOf(event: EventRecord): Promise<PublishProblem[]> {
    const types = await ticketTypes.listByEvent(event.id);
    return publishReadiness({ event, ticketTypeCount: types.length, now: now() });
  }

  return {
    listEvents(): Promise<EventRecord[]> {
      return repo.list();
    },

    getEvent,

    /** @throws EventSlugTakenError (from the repository) on a duplicate slug. */
    createEvent(input: CreateEventInput): Promise<EventRecord> {
      const defaults = defaultRegistrationWindow(input.startsAt);
      return repo.insert({
        title: input.title,
        slug: input.slug ?? slugify(input.title),
        description: input.description ?? null,
        venue: input.venue ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt ?? null,
        registrationOpensAt: input.registrationOpensAt ?? defaults.registrationOpensAt,
        registrationClosesAt: input.registrationClosesAt ?? defaults.registrationClosesAt,
      });
    },

    /**
     * Full-form update: every field is replaced with what the form submitted.
     * A cleared registration bound falls back to the default rule again, and
     * a cleared slug is re-derived from the (possibly new) title.
     * @throws EventNotFoundError, EventSlugTakenError
     */
    async updateEvent(id: string, input: UpdateEventInput): Promise<EventRecord> {
      const defaults = defaultRegistrationWindow(input.startsAt);
      const patch: EventPatch = {
        title: input.title,
        slug: input.slug ?? slugify(input.title),
        description: input.description ?? null,
        venue: input.venue ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt ?? null,
        registrationOpensAt: input.registrationOpensAt ?? defaults.registrationOpensAt,
        registrationClosesAt: input.registrationClosesAt ?? defaults.registrationClosesAt,
      };
      const updated = await repo.update(id, patch);
      if (!updated) throw new EventNotFoundError(id);
      return updated;
    },

    /** What currently blocks publishing (empty = ready). Shown on the edit page. */
    async publishReadinessFor(id: string): Promise<PublishProblem[]> {
      return readinessOf(await getEvent(id));
    },

    /**
     * The only way an event's status changes.
     * @throws EventNotFoundError, InvalidEventTransitionError,
     *   EventNotPublishableError, EventStatusConflictError
     */
    async changeEventStatus(id: string, to: EventStatus): Promise<EventRecord> {
      const event = await getEvent(id);
      assertEventTransition(event.status, to);

      if (to === 'published') {
        const problems = await readinessOf(event);
        if (problems.length > 0) {
          throw new EventNotPublishableError(problems.map((p) => p.message));
        }
      }

      // Conditional on the status we validated against; null means it moved.
      const updated = await repo.transitionStatus(id, event.status, to);
      if (!updated) throw new EventStatusConflictError(id);
      return updated;
    },
  };
}

export type EventsService = ReturnType<typeof createEventsService>;
