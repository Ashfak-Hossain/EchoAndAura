import { asc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import type { DbExecutor } from '@/db/executor';
import { tickets } from '@/db/schema';
import { TicketCodeCollisionError } from '@/server/lib/errors';
import { isUniqueViolation } from '@/server/lib/pg-errors';

/**
 * The only module that touches Drizzle for `tickets`. Rows are created by
 * fulfilment (Invariant 4) inside the approve transaction; nothing here
 * changes a ticket's status (cancel arrives with Phase 6, as a conditional
 * UPDATE like every other status write).
 */

export type TicketRecord = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;

export interface TicketsRepository {
  /** @throws TicketCodeCollisionError when any code is already taken. */
  insertMany(rows: NewTicket[], tx?: DbExecutor): Promise<TicketRecord[]>;
  listByOrder(orderId: string): Promise<TicketRecord[]>;
  findByCode(code: string): Promise<TicketRecord | null>;
}

// Constraint name as generated in drizzle/0000_*.sql.
const CODE_UNIQUE = 'tickets_code_unique';

export const ticketsRepository: TicketsRepository = {
  async insertMany(rows, tx = db) {
    if (rows.length === 0) return [];
    try {
      return await tx.insert(tickets).values(rows).returning();
    } catch (err: unknown) {
      if (isUniqueViolation(err, CODE_UNIQUE)) {
        throw new TicketCodeCollisionError(rows.map((r) => r.code).join(','));
      }
      throw err;
    }
  },

  listByOrder(orderId) {
    return db
      .select()
      .from(tickets)
      .where(eq(tickets.orderId, orderId))
      .orderBy(asc(tickets.createdAt), asc(tickets.code));
  },

  async findByCode(code) {
    const [row] = await db.select().from(tickets).where(eq(tickets.code, code)).limit(1);
    return row ?? null;
  },
};
