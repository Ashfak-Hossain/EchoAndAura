/**
 * Marks an existing user as the admin (role = 'admin'). Needed once for an
 * admin created before the role column existed, or to hand the back office
 * to another email.
 *
 *   pnpm admin:promote <email>
 */
import { eq } from 'drizzle-orm';
import { db, queryClient } from '@/db/client';
import { users } from '@/db/schema';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: pnpm admin:promote <email>');
    process.exitCode = 1;
    return;
  }
  const [row] = await db
    .update(users)
    .set({ role: 'admin' })
    .where(eq(users.email, email))
    .returning({ id: users.id });
  if (!row) {
    console.error(`No user with email ${email}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Promoted ${email} to admin (${row.id})`);
}

main().finally(() => queryClient.end());
