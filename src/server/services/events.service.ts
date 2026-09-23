import {
  type CoverImageMeta,
  coverImageKey,
  isCoverKeyForEvent,
  validateCoverImage,
} from '@/server/lib/cover-image';
import {
  CoverImageNotUploadedError,
  EventNotFoundError,
  EventNotPublishableError,
  EventStatusConflictError,
} from '@/server/lib/errors';
import { descriptionToHtml } from '@/server/lib/description';
import { type EventStatus, assertEventTransition } from '@/server/lib/event-status';
import { type EventPhase, eventPhase } from '@/server/lib/event-phase';
import {
  type HomeSelection,
  selectArchiveEvents,
  selectHomeEvents,
} from '@/server/lib/home-events';
import { type PublishProblem, publishReadiness } from '@/server/lib/publish-readiness';
import { defaultRegistrationWindow } from '@/server/lib/registration-window';
import { slugify } from '@/server/lib/slug';
import type {
  EventPatch,
  EventRecord,
  EventsRepository,
} from '@/server/repositories/events.repository';
import type {
  TicketTypeRecord,
  TicketTypesRepository,
} from '@/server/repositories/ticket-types.repository';
import type { ObjectStorage, UploadTarget } from '@/server/storage/object-storage';
import { forPublic } from '@/server/lib/venue';

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
  /** Where a failed best-effort cleanup is reported. */
  warn?: (message: string, err: unknown) => void;
}

export interface CreateEventInput {
  title: string;
  /** Optional explicit URL slug; derived from the title when omitted. */
  slug?: string;
  description?: string;
  venue?: string;
  /** Private venue: public pages show `venueArea` and a note instead (ADR-029). */
  venueHidden?: boolean;
  venueArea?: string;
  startsAt: Date;
  endsAt?: Date;
  /** Either registration bound left undefined falls back to the 20/5-day rule. */
  registrationOpensAt?: Date;
  registrationClosesAt?: Date;
}

export type UpdateEventInput = CreateEventInput;

/** One event as the home page shows it: hero, "also upcoming" card or past row. */
export interface HomeEvent {
  event: EventRecord;
  phase: EventPhase;
  /** Lowest ticket price in paisa; null when no ticket types exist. */
  fromPricePaisa: number | null;
  /** Tickets still available across every type (the hero's "112 left"). */
  availableTotal: number;
  coverUrl: string | null;
}

/** One past event as the archive lists it. */
export interface ArchiveEvent {
  event: EventRecord;
  coverUrl: string | null;
}

export function createEventsService(
  repo: EventsRepository,
  ticketTypes: TicketTypesRepository,
  storage: ObjectStorage,
  { now = () => new Date(), warn = console.warn }: EventsServiceOptions = {},
) {
  async function getEvent(id: string): Promise<EventRecord> {
    const event = await repo.findById(id);
    if (!event) throw new EventNotFoundError(id);
    return event;
  }

  async function readinessOf(event: EventRecord): Promise<PublishProblem[]> {
    const types = await ticketTypes.listByEvent(event.id);
    return publishReadiness({
      event,
      ticketTypeCount: types.length,
      now: now(),
    });
  }

  return {
    listEvents(): Promise<EventRecord[]> {
      return repo.list();
    },

    getEvent,

    /**
     * The public read model (A2). Only published and archived events have a
     * page: archived ones keep their URL so links shared on Facebook stay
     * alive. Drafts are invisible — the same not-found as an unknown slug.
     * @throws EventNotFoundError
     */
    async getPublicEvent(
      slug: string,
    ): Promise<{ event: EventRecord; ticketTypes: TicketTypeRecord[] }> {
      const event = await repo.findBySlug(slug);
      if (!event || event.status === 'draft') throw new EventNotFoundError(slug);
      // Public read model: a private venue never leaves the server (ADR-029).
      return { event: forPublic(event), ticketTypes: await ticketTypes.listByEvent(event.id) };
    },

    /**
     * The home page read model (A1): hero, "also upcoming", past strip.
     * One events query, one capacity GROUP BY for every event shown — never
     * a query per event.
     */
    async getHomePage(at: Date = now()): Promise<HomeSelection<HomeEvent>> {
      const visible = (await repo.listByStatus(['published', 'archived'])).map(forPublic);
      const picked = selectHomeEvents(visible, at);
      const shown = [picked.featured, ...picked.alsoUpcoming, ...picked.past].filter(
        (e): e is EventRecord => e !== null,
      );
      const capacity = new Map(
        (await ticketTypes.capacityByEvent(shown.map((e) => e.id))).map((c) => [c.eventId, c]),
      );

      const decorate = (event: EventRecord): HomeEvent => {
        const cap = capacity.get(event.id);
        const availableTotal = cap ? Math.max(0, cap.total - cap.sold - cap.held) : 0;
        return {
          event,
          phase: eventPhase({ event, availableTotal, now: at }),
          fromPricePaisa: cap?.fromPricePaisa ?? null,
          availableTotal,
          coverUrl: event.imageKey ? storage.publicUrl(event.imageKey) : null,
        };
      };

      return {
        featured: picked.featured ? decorate(picked.featured) : null,
        alsoUpcoming: picked.alsoUpcoming.map(decorate),
        past: picked.past.map(decorate),
      };
    },

    /**
     * The archive read model (A6): everything that has happened, newest
     * first. One events query; no capacity query, nothing here is on sale.
     */
    async getArchivePage(at: Date = now()): Promise<ArchiveEvent[]> {
      const visible = (await repo.listByStatus(['published', 'archived'])).map(forPublic);
      return selectArchiveEvents(visible, at).map((event) => ({
        event,
        coverUrl: event.imageKey ? storage.publicUrl(event.imageKey) : null,
      }));
    },

    /** @throws EventSlugTakenError (from the repository) on a duplicate slug. */
    createEvent(input: CreateEventInput): Promise<EventRecord> {
      const defaults = defaultRegistrationWindow(input.startsAt);
      return repo.insert({
        title: input.title,
        slug: input.slug ?? slugify(input.title),
        description: cleanDescription(input.description),
        ...venueFields(input),
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
        description: cleanDescription(input.description),
        ...venueFields(input),
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

    /** Public URL for the cover image, or null when none is set. */
    coverImageUrl(event: Pick<EventRecord, 'imageKey'>): string | null {
      return event.imageKey ? storage.publicUrl(event.imageKey) : null;
    },

    /**
     * Step 1 of the upload: validate what the browser says it will send and
     * presign a PUT bound to exactly that type and size.
     * @throws EventNotFoundError, CoverImageInvalidError
     */
    async createCoverUpload(id: string, meta: CoverImageMeta): Promise<UploadTarget> {
      await getEvent(id);
      validateCoverImage(meta);
      return storage.createUploadUrl({
        key: coverImageKey(id, meta.contentType),
        contentType: meta.contentType,
        size: meta.size,
      });
    },

    /**
     * Step 3: the browser reports the key it uploaded to. Trust nothing —
     * the key must be one this event could have been issued, the object must
     * exist, and what storage received must pass the same validation. The
     * old object is deleted only after the row points at the new one, and
     * never inside a transaction (Invariant 7).
     * @throws EventNotFoundError, CoverImageNotUploadedError, CoverImageInvalidError
     */
    async setCoverImage(id: string, key: string): Promise<EventRecord> {
      const event = await getEvent(id);
      if (!isCoverKeyForEvent(key, id)) throw new CoverImageNotUploadedError(key);

      const info = await storage.head(key);
      if (!info || info.contentType === undefined || info.size === undefined) {
        throw new CoverImageNotUploadedError(key);
      }
      validateCoverImage({ contentType: info.contentType, size: info.size });

      const updated = await repo.setImageKey(id, key);
      if (!updated) throw new EventNotFoundError(id);

      if (event.imageKey && event.imageKey !== key) await bestEffortDelete(event.imageKey);
      return updated;
    },

    /** @throws EventNotFoundError */
    async removeCoverImage(id: string): Promise<EventRecord> {
      const event = await getEvent(id);
      const updated = await repo.setImageKey(id, null);
      if (!updated) throw new EventNotFoundError(id);
      if (event.imageKey) await bestEffortDelete(event.imageKey);
      return updated;
    },
  };

  // Writes only ever store allowlisted HTML (ADR-010): editor output is
  // sanitised, plain text is wrapped in paragraphs, an empty editor is NULL.
  function cleanDescription(raw: string | undefined): string | null {
    return descriptionToHtml(raw);
  }

  // An orphaned object costs a few KB; a failed delete must never undo a
  // successful row update, so it is logged rather than thrown.
  async function bestEffortDelete(key: string): Promise<void> {
    try {
      await storage.delete(key);
    } catch (err: unknown) {
      warn(`events.service: could not delete old cover image ${key}`, err);
    }
  }
}

export type EventsService = ReturnType<typeof createEventsService>;

/** The area only means something while the venue is private; a public venue stores none. */
function venueFields(input: CreateEventInput) {
  const venueHidden = input.venueHidden ?? false;
  return {
    venue: input.venue ?? null,
    venueHidden,
    venueArea: venueHidden ? (input.venueArea ?? null) : null,
  };
}
