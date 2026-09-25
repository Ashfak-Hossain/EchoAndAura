import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import type { DbExecutor } from '@/db/executor';
import { sponsors } from '@/db/schema';
import { SponsorPresentingConflictError } from '@/server/lib/errors';
import { isUniqueViolation } from '@/server/lib/pg-errors';

/**
 * The only module that touches Drizzle for `sponsors` (B15). Positions are
 * 1…n within a level; the service keeps them dense by calling `renumber`
 * inside the same transaction as every write, after taking `lock`.
 */

export type SponsorRecord = typeof sponsors.$inferSelect;
export type SponsorLevel = SponsorRecord['level'];
export type SponsorTileTone = SponsorRecord['tileTone'];

export interface NewSponsor {
  id: string;
  name: string;
  websiteUrl: string | null;
  level: SponsorLevel;
  logoKey: string;
  logoWidth: number;
  logoHeight: number;
  tileTone: SponsorTileTone;
  active: boolean;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export type SponsorPatch = Partial<Omit<NewSponsor, 'id' | 'createdAt'>>;

export interface SponsorsRepository {
  /**
   * First statement of every sponsor write. A renumber reads a level's ids
   * and rewrites their positions; two admins doing that at once would
   * interleave and leave duplicate or missing positions. One lock for the
   * whole table: writes are rare and tiny, so serialising them costs nothing.
   */
  lock(tx: DbExecutor): Promise<void>;
  findById(id: string, tx?: DbExecutor): Promise<SponsorRecord | null>;
  /** Every sponsor in display order: level, position, created_at, id. */
  listAll(): Promise<SponsorRecord[]>;
  /** Active sponsors only, same order. */
  listActive(): Promise<SponsorRecord[]>;
  /** One level's ids in display order. */
  listIdsByLevel(level: SponsorLevel, tx: DbExecutor): Promise<string[]>;
  /** @throws SponsorPresentingConflictError */
  insert(values: NewSponsor, tx: DbExecutor): Promise<SponsorRecord>;
  /** Null when no row has this id. @throws SponsorPresentingConflictError */
  update(id: string, patch: SponsorPatch, tx: DbExecutor): Promise<SponsorRecord | null>;
  /** The deleted row, or null when there was none. */
  delete(id: string, tx: DbExecutor): Promise<SponsorRecord | null>;
  /**
   * Moves the presenting sponsor (unless it is `keepId`) to Partner #1,
   * shifting every partner down one. Resolves the demoted row, or null
   * when there was nothing to demote.
   */
  demotePresenting(keepId: string | null, at: Date, tx: DbExecutor): Promise<SponsorRecord | null>;
  /** Positions 1…n in the order given, in one statement. `ids` is a whole level. */
  renumber(ids: readonly string[], tx: DbExecutor): Promise<void>;
}

// Constraint names as generated in drizzle/0020_*.sql.
const ONE_PRESENTING = 'sponsors_one_presenting';

// pg_advisory_xact_lock key for sponsor writes. Any fixed bigint works as
// long as nothing else in the app uses it; this one is "SPON" in ASCII.
// Released automatically at commit or rollback.
const SPONSORS_LOCK_KEY = 0x53_50_4f_4e;

const DISPLAY_ORDER = [
  asc(sponsors.level),
  asc(sponsors.position),
  asc(sponsors.createdAt),
  asc(sponsors.id),
];

function rethrowPresenting(err: unknown): never {
  if (isUniqueViolation(err, ONE_PRESENTING)) throw new SponsorPresentingConflictError();
  throw err;
}

export const sponsorsRepository: SponsorsRepository = {
  async lock(tx) {
    await tx.execute(sql`select pg_advisory_xact_lock(${SPONSORS_LOCK_KEY}::bigint)`);
  },

  async findById(id, tx = db) {
    const [row] = await tx.select().from(sponsors).where(eq(sponsors.id, id)).limit(1);
    return row ?? null;
  },

  listAll() {
    return db
      .select()
      .from(sponsors)
      .orderBy(...DISPLAY_ORDER);
  },

  listActive() {
    return db
      .select()
      .from(sponsors)
      .where(eq(sponsors.active, true))
      .orderBy(...DISPLAY_ORDER);
  },

  async listIdsByLevel(level, tx) {
    const rows = await tx
      .select({ id: sponsors.id })
      .from(sponsors)
      .where(eq(sponsors.level, level))
      .orderBy(...DISPLAY_ORDER);
    return rows.map((r) => r.id);
  },

  async insert(values, tx) {
    try {
      const [row] = await tx.insert(sponsors).values(values).returning();
      if (!row) throw new Error('insert returned no row');
      return row;
    } catch (err: unknown) {
      rethrowPresenting(err);
    }
  },

  async update(id, patch, tx) {
    try {
      const [row] = await tx.update(sponsors).set(patch).where(eq(sponsors.id, id)).returning();
      return row ?? null;
    } catch (err: unknown) {
      rethrowPresenting(err);
    }
  },

  async delete(id, tx) {
    const [row] = await tx.delete(sponsors).where(eq(sponsors.id, id)).returning();
    return row ?? null;
  },

  async demotePresenting(keepId, at, tx) {
    const [current] = await tx
      .select({ id: sponsors.id })
      .from(sponsors)
      .where(
        and(
          eq(sponsors.level, 'presenting'),
          keepId === null ? undefined : ne(sponsors.id, keepId),
        ),
      );
    if (!current) return null;
    // Make room at the top of the partners, then move it there: the design
    // shows the old presenting partner as Partner #1.
    await tx
      .update(sponsors)
      .set({ position: sql`${sponsors.position} + 1` })
      .where(eq(sponsors.level, 'partner'));
    const [row] = await tx
      .update(sponsors)
      .set({ level: 'partner', position: 1, updatedAt: at })
      .where(eq(sponsors.id, current.id))
      .returning();
    return row ?? null;
  },

  async renumber(ids, tx) {
    if (ids.length === 0) return;
    const values = sql.join(
      ids.map((id, i) => sql`(${id}::uuid, ${i + 1}::int)`),
      sql`, `,
    );
    // One statement for the whole level; rows already in place are skipped.
    // Positions are an ordering, not an edit: updated_at is left alone.
    await tx.execute(sql`
      update ${sponsors} set "position" = v.position
      from (values ${values}) as v(id, position)
      where ${sponsors.id} = v.id and ${sponsors.position} <> v.position
    `);
  },
};
