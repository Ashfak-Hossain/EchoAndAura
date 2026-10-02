import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { signOutAction } from '@/app/admin/(protected)/actions';
import { AuthScreen } from '@/components/admin/auth-screen';
import { requireAdminPendingTwoFactor } from '@/lib/session';
import { SetupFlow } from './setup-flow';

export const metadata: Metadata = { title: 'Set up two-factor sign-in' };

/**
 * ADR-049: where `requireAdmin()` sends an admin without a second factor.
 * Outside (protected) on purpose: no console around it, only this and
 * sign-out.
 */
export default async function TwoFactorSetupPage() {
  // A server action that sets a cookie makes Next re-render this page in
  // the same request. The confirm step does (better-auth replaces the
  // session when two-factor turns on), but `headers()` still carries the
  // old, now deleted session: checking it here would bounce to sign-in,
  // and "already on → /admin" would skip step 3, the backup codes. So the
  // check runs on a real page load only. Nothing is lost: the page itself
  // holds no secret, and every action checks the session for itself.
  if (!(await headers()).has('next-action')) {
    const admin = await requireAdminPendingTwoFactor();
    if (admin.twoFactorEnabled) redirect('/admin');
  }

  return (
    <AuthScreen
      title="Set up two-factor sign-in"
      subtitle="Your account needs two-factor sign-in before you can use the console."
      footer={
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-sm font-medium text-foreground underline underline-offset-4 hover:no-underline"
          >
            Sign out
          </button>
        </form>
      }
    >
      <SetupFlow />
    </AuthScreen>
  );
}
