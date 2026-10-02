import { and, eq, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { sessions, twoFactors, users } from '@/db/schema';

/**
 * ADR-038: the one thing the account flows need beyond better-auth's own
 * endpoints — signing an account out everywhere after its email moved.
 * ADR-049 adds the lost-phone recovery behind `pnpm admin:reset-2fa`.
 */
export interface AdminAccountsRepository {
  /** Deletes every session of the user; returns how many there were. */
  revokeAllSessions(userId: string): Promise<number>;
  /**
   * Deletes the user's sessions created before `before`; returns how many.
   * Used when two-factor turns on: sessions that never passed a code must
   * not inherit the account-level flag.
   */
  revokeSessionsCreatedBefore(userId: string, before: Date): Promise<number>;
  /** The user with this (already lowercased) email, or null. */
  findByEmail(email: string): Promise<{ id: string; email: string; role: string } | null>;
  /**
   * Removes the user's authenticator secret and backup codes, turns
   * two-factor off and signs them out everywhere. Returns how many
   * sessions were revoked.
   */
  resetTwoFactor(userId: string): Promise<{ sessionsRevoked: number }>;
}

export const adminAccountsRepository: AdminAccountsRepository = {
  async revokeAllSessions(userId) {
    const rows = await db
      .delete(sessions)
      .where(eq(sessions.userId, userId))
      .returning({ id: sessions.id });
    return rows.length;
  },

  async revokeSessionsCreatedBefore(userId, before) {
    const rows = await db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), lt(sessions.createdAt, before)))
      .returning({ id: sessions.id });
    return rows.length;
  },

  async findByEmail(email) {
    const [row] = await db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return row ?? null;
  },

  async resetTwoFactor(userId) {
    // One transaction: a half-reset (flag off but old secret still there,
    // or the reverse) would leave the account in a state better-auth
    // never produces itself.
    return db.transaction(async (tx) => {
      // The old secret and backup codes are on the lost phone / paper;
      // deleting the row (lockout counters included) means the next setup
      // generates a fresh secret instead of reusing a leaked one.
      await tx.delete(twoFactors).where(eq(twoFactors.userId, userId));
      // With the flag off, signInEmail no longer asks for a code: the next
      // sign-in is password only, and requireAdmin() then forces the setup
      // page before anything else in the console opens.
      await tx
        .update(users)
        .set({ twoFactorEnabled: false, updatedAt: new Date() })
        .where(eq(users.id, userId));
      // Whoever has the lost phone may also hold a live session; kill them
      // all so only someone who knows the password gets back in.
      const revoked = await tx
        .delete(sessions)
        .where(eq(sessions.userId, userId))
        .returning({ id: sessions.id });
      return { sessionsRevoked: revoked.length };
    });
  },
};
