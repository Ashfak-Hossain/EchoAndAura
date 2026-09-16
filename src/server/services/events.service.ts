import { EventNotFoundError } from '@/server/lib/errors';
import { defaultRegistrationWindow } from '@/server/lib/registration-window';
import { slugify } from '@/server/lib/slug';
import type {
  EventPatch,
  EventRecord,
  EventsRepository,
} from '@/server/repositories/events.repository';

/**
 * Event business rules. Built by a factory that receives its repository, so
 * this module never imports the database: unit tests pass an in-memory fake,
 * and `src/server/container.ts` wires the real one for the app.
 *
 * Status is not touched here: events are created as `draft`, and
 * publish/unpublish is a separate service concern (later slice).
 */

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

export function createEventsService(repo: EventsRepository) {
  return {
    listEvents(): Promise<EventRecord[]> {
      return repo.list();
    },

    async getEvent(id: string): Promise<EventRecord> {
      const event = await repo.findById(id);
      if (!event) throw new EventNotFoundError(id);
      return event;
    },

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
  };
}

export type EventsService = ReturnType<typeof createEventsService>;
