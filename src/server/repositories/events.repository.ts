import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { events } from '@/db/schema';
import { EventSlugTakenError } from '@/server/lib/errors';
import type { EventStatus } from '@/server/lib/event-status';
import { isUniqueViolation } from '@/server/lib/pg-errors';

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
    | 'startsAt'
    | 'endsAt'
    | 'registrationOpensAt'
    | 'registrationClosesAt'
  >
>;

export interface EventsRepository {
  list(): Promise<EventRecord[]>;
  findById(id: string): Promise<EventRecord | null>;
  /** @throws EventSlugTakenError when the slug is already in use. */
  insert(values: NewEvent): Promise<EventRecord>;
  /** Resolves null when no row has this id. @throws EventSlugTakenError */
  update(id: string, patch: EventPatch): Promise<EventRecord | null>;
  /**
   * Conditional status change: succeeds only if the row is still in `from`.
   * Resolves null when it is not (changed concurrently, or no such event).
   */
  transitionStatus(id: string, from: EventStatus, to: EventStatus): Promise<EventRecord | null>;
  /** Sets (or clears, with null) the cover image key. Resolves null when no row has this id. */
  setImageKey(id: string, imageKey: string | null): Promise<EventRecord | null>;
}

// Slug uniqueness is enforced by the DB, never by a read-then-write check,
// so the unique violation is where a duplicate surfaces.
function rethrowSlugConflict(err: unknown, slug: string | undefined): never {
  if (slug !== undefined && isUniqueViolation(err, 'events_slug_unique')) {
    throw new EventSlugTakenError(slug);
  }
  throw err;
}

export const eventsRepository: EventsRepository = {
  list() {
    return db.select().from(events).orderBy(desc(events.startsAt));
  },

  async findById(id) {
    const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
    return row ?? null;
  },

  async insert(values) {
    try {
      const [row] = await db.insert(events).values(values).returning();
      if (!row) throw new Error('insert returned no row');
      return row;
    } catch (err: unknown) {
      rethrowSlugConflict(err, values.slug);
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
      rethrowSlugConflict(err, patch.slug);
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
