import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { events } from '@/db/schema';
import { EventSlugTakenError, SponsorNotFoundError } from '@/server/lib/errors';
import type { EventStatus } from '@/server/lib/event-status';
import { isForeignKeyViolation, isUniqueViolation } from '@/server/lib/pg-errors';

/**
 * The only module that touches Drizzle for `events` (architecture rule:
 * repositories own DB access; services call repositories). The interface is
 * what services depend on, so unit tests supply an in-memory fake.
 */

export type EventRecord = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type EventPatch = Partial<
  Pick<
    NewEvent,
    | 'title'
    | 'slug'
    | 'description'
    | 'venue'
    | 'venueHidden'
    | 'venueArea'
    | 'startsAt'
    | 'endsAt'
    | 'registrationOpensAt'
    | 'registrationClosesAt'
    | 'presentingSponsorId'
  >
>;

export interface EventsRepository {
  list(): Promise<EventRecord[]>;
  /** Events in any of `statuses`, soonest first (the public read model). */
  listByStatus(statuses: EventStatus[]): Promise<EventRecord[]>;
  findById(id: string): Promise<EventRecord | null>;
  findBySlug(slug: string): Promise<EventRecord | null>;
  /**
   * @throws EventSlugTakenError when the slug is already in use,
   *   SponsorNotFoundError when the presenting sponsor does not exist.
   */
  insert(values: NewEvent): Promise<EventRecord>;
  /**
   * Resolves null when no row has this id.
   * @throws EventSlugTakenError, SponsorNotFoundError
   */
  update(id: string, patch: EventPatch): Promise<EventRecord | null>;
  /**
   * Conditional status change: succeeds only if the row is still in `from`.
   * Resolves null when it is not (changed concurrently, or no such event).
   */
  transitionStatus(id: string, from: EventStatus, to: EventStatus): Promise<EventRecord | null>;
  /** Sets (or clears, with null) the cover image key. Resolves null when no row has this id. */
  setImageKey(id: string, imageKey: string | null): Promise<EventRecord | null>;
}

// Constraint names as generated in drizzle/0000_*.sql and 0021_*.sql.
const SLUG_UNIQUE = 'events_slug_unique';
const PRESENTING_SPONSOR_FK = 'events_presenting_sponsor_id_sponsors_id_fk';

// Slug uniqueness and the presenting sponsor's existence are enforced by
// the DB, never by a read-then-write check: a sponsor deleted while the
// event form was open surfaces here, as the foreign-key violation.
function rethrowWriteConflict(err: unknown, values: EventPatch): never {
  if (values.slug !== undefined && isUniqueViolation(err, SLUG_UNIQUE)) {
    throw new EventSlugTakenError(values.slug);
  }
  if (values.presentingSponsorId && isForeignKeyViolation(err, PRESENTING_SPONSOR_FK)) {
    throw new SponsorNotFoundError(values.presentingSponsorId);
  }
  throw err;
}

export const eventsRepository: EventsRepository = {
  list() {
    return db.select().from(events).orderBy(desc(events.startsAt));
  },

  listByStatus(statuses) {
    if (statuses.length === 0) return Promise.resolve([]);
    return db
      .select()
      .from(events)
      .where(inArray(events.status, statuses))
      .orderBy(asc(events.startsAt));
  },

  async findById(id) {
    const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
    return row ?? null;
  },

  async findBySlug(slug) {
    const [row] = await db.select().from(events).where(eq(events.slug, slug)).limit(1);
    return row ?? null;
  },

  async insert(values) {
    try {
      const [row] = await db.insert(events).values(values).returning();
      if (!row) throw new Error('insert returned no row');
      return row;
    } catch (err: unknown) {
      rethrowWriteConflict(err, values);
    }
  },

  async update(id, patch) {
    try {
      const [row] = await db
        .update(events)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(events.id, id))
        .returning();
      return row ?? null;
    } catch (err: unknown) {
      rethrowWriteConflict(err, patch);
    }
  },

  async transitionStatus(id, from, to) {
    // The `status = from` predicate makes this atomic: two admin tabs both
    // publishing can't both succeed, and no read-then-write window exists.
    const [row] = await db
      .update(events)
      .set({ status: to, updatedAt: new Date() })
      .where(and(eq(events.id, id), eq(events.status, from)))
      .returning();
    return row ?? null;
  },

  async setImageKey(id, imageKey) {
    const [row] = await db
      .update(events)
      .set({ imageKey, updatedAt: new Date() })
      .where(eq(events.id, id))
      .returning();
    return row ?? null;
  },
};
