import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

/** ADR-036: the health check's one query — does Postgres answer at all. */
export interface HealthRepository {
  ping(): Promise<void>;
}

export const healthRepository: HealthRepository = {
  async ping() {
    await db.execute(sql`select 1`);
  },
};
