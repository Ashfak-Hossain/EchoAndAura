import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { settings } from '@/db/schema';

/**
 * The only module that touches Drizzle for `settings` (B14). One row,
 * `id = 1`, created by the first save: `get` returns null until then and
 * the service supplies the fallbacks.
 */
export type SettingsRecord = typeof settings.$inferSelect;

/**
 * Every organizer-editable field, all present: the row is always saved
 * whole. (A partial object would insert NULLs on the first save but keep
 * columns on later ones — two behaviours for one call.) null = "none".
 */
export type SettingsPatch = Required<
  Omit<typeof settings.$inferInsert, 'id' | 'updatedAt' | 'updatedBy'>
>;

export interface SettingsRepository {
  get(): Promise<SettingsRecord | null>;
  /** Insert-or-update the single row; `updatedBy` is the admin's email. */
  upsert(values: SettingsPatch, updatedBy: string): Promise<SettingsRecord>;
}

const SINGLE_ROW_ID = 1;

export const settingsRepository: SettingsRepository = {
  async get() {
    const [row] = await db.select().from(settings).limit(1);
    return row ?? null;
  },

  async upsert(values, updatedBy) {
    const [row] = await db
      .insert(settings)
      .values({ id: SINGLE_ROW_ID, ...values, updatedBy })
      .onConflictDoUpdate({
        target: settings.id,
        set: { ...values, updatedBy, updatedAt: sql`now()` },
      })
      .returning();
    if (!row) throw new Error('settings upsert returned no row');
    return row;
  },
};
