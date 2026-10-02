import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthScreen } from '@/components/admin/auth-screen';
import { auth } from '@/lib/auth';
import { VerifyForm } from './verify-form';

export const metadata: Metadata = { title: 'Enter your code' };

/**
 * better-auth's challenge cookie, named the way better-auth names it (its
 * prefix, and `__Secure-` over https), so a config change can't make this
 * page bounce everyone. Presence only: better-auth checks the signature
 * and the expiry when the code is sent.
 */
async function hasTwoFactorChallenge(): Promise<boolean> {
  const { name } = (await auth.$context).createAuthCookie('two_factor');
  return (await cookies()).has(name);
}

// ADR-049: step 2 of the admin sign-in. No session exists yet (the proxy
// lets this page through); the password step left a 10-minute challenge.
export default async function AdminVerifyPage() {
  // Already signed in? Nothing to verify.
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect('/admin');
  // Reached directly, or the challenge cookie expired: start over.
  if (!(await hasTwoFactorChallenge())) redirect('/admin/login');

  return (
    <AuthScreen
      title="Two-factor sign-in"
      subtitle="Enter the 6-digit code from your authenticator app."
      footer={
        <p className="text-sm">
          <Link
            href="/admin/login"
            className="font-medium text-foreground underline underline-offset-4 hover:no-underline"
          >
            Back to sign in
          </Link>
        </p>
      }
    >
      <VerifyForm />
    </AuthScreen>
  );
}
