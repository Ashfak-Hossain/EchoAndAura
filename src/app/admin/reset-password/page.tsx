import type { Metadata } from 'next';
import { AuthScreen } from '@/components/admin/auth-screen';
import { DeadLink, ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = { title: 'Choose a new password' };

interface Props {
  /** better-auth checks the emailed link first, then lands here with the token or an error. */
  searchParams: Promise<{ token?: string; error?: string }>;
}

// ADR-038: step 2 of a reset — the page the emailed link opens.
export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token, error } = await searchParams;
  return (
    <AuthScreen
      title="Choose a new password"
      subtitle="Saving it signs you out everywhere, then you sign in with the new one."
    >
      {token && !error ? <ResetPasswordForm token={token} /> : <DeadLink />}
    </AuthScreen>
  );
}
