import { desc, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '@/db/client';
import { events } from '@/db/schema';
import { EventSlugTakenError } from '@/server/lib/errors';

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
}

// Postgres SQLSTATE for unique_violation. Uniqueness is enforced by the DB,
// never by a read-then-write check, so this is where a duplicate surfaces.
const UNIQUE_VIOLATION = '23505';

/**
 * Drizzle wraps driver failures in `DrizzleQueryError` and exposes the
 * original `PostgresError` as `cause`, so walk the cause chain rather than
 * checking only the top-level error.
 */
function findPostgresError(err: unknown): postgres.PostgresError | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (current instanceof postgres.PostgresError) return current;
    current = current.cause;
  }
  return null;
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const pgError = findPostgresError(err);
  return (
    pgError !== null && pgError.code === UNIQUE_VIOLATION && pgError.constraint_name === constraint
  );
}

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
};
