import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthScreen } from '@/components/admin/auth-screen';
import { PASSWORD_RESET_TTL_SECONDS } from '@/server/auth/account-emails';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = { title: 'Forgot password' };

// ADR-038: step 1 of a reset — ask for the address, email a link.
export default function ForgotPasswordPage() {
  return (
    <AuthScreen
      title="Forgot your password?"
      subtitle="Enter the email you sign in with. We will send a link to choose a new password."
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
      <ForgotPasswordForm ttlMinutes={PASSWORD_RESET_TTL_SECONDS / 60} />
    </AuthScreen>
  );
}
