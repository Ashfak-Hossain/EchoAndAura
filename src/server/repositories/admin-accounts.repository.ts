import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { sessions } from '@/db/schema';

/**
 * ADR-038: the one thing the account flows need beyond better-auth's own
 * endpoints — signing an account out everywhere after its email moved.
 */
export interface AdminAccountsRepository {
  /** Deletes every session of the user; returns how many there were. */
  revokeAllSessions(userId: string): Promise<number>;
}

export const adminAccountsRepository: AdminAccountsRepository = {
  async revokeAllSessions(userId) {
    const rows = await db
      .delete(sessions)
      .where(eq(sessions.userId, userId))
      .returning({ id: sessions.id });
    return rows.length;
  },
};
