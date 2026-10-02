/**
 * ADR-049: recovery for an admin who lost both the authenticator app and
 * the backup codes. Turns their two-factor off and signs them out
 * everywhere; at the next sign-in (password only) the console sends them
 * straight to the setup page for a fresh secret and new backup codes.
 *
 * Deliberately a server script, not a button: whoever runs it already has
 * shell access to production, so a stolen password alone can't undo 2FA.
 *
 *   pnpm admin:reset-2fa <email>
 */
import { queryClient } from '@/db/client';
import { adminAccountsRepository } from '@/server/repositories/admin-accounts.repository';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: pnpm admin:reset-2fa <email>');
    process.exitCode = 1;
    return;
  }

  const user = await adminAccountsRepository.findByEmail(email);
  if (!user) {
    console.error(`No user with email ${email}`);
    process.exitCode = 1;
    return;
  }
  // Buyers sign in by magic link and never have two-factor.
  if (user.role !== 'admin') {
    console.error(`${email} is not an admin; only admins have two-factor.`);
    process.exitCode = 1;
    return;
  }

  await adminAccountsRepository.resetTwoFactor(user.id);
  console.log(`Two-factor reset for ${email}. They must set it up again at their next sign-in.`);
}

main()
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to reset two-factor: ${message}`);
    process.exitCode = 1;
  })
  .finally(() => queryClient.end());
