import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthScreen } from '@/components/admin/auth-screen';
import { FormAlert, FormSuccess } from '@/components/form-field';
import { auth } from '@/lib/auth';
import { readTurnstileConfig } from '@/lib/turnstile-config';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

interface Props {
  /** Where the account flows land (ADR-038): a finished reset or email change, or a dead link. */
  searchParams: Promise<{ reset?: string; email?: string; error?: string }>;
}

// B1: split screen — the brand panel and the form (AuthScreen).
export default async function AdminLoginPage({ searchParams }: Props) {
  // Already signed in? Skip the form.
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect('/admin');
  const { reset, email, error } = await searchParams;

  return (
    <AuthScreen
      title="Sign in"
      subtitle="Use the email the console was set up with."
      footer={
        <p className="text-sm">
          <Link
            href="/admin/forgot-password"
            className="font-medium text-foreground underline underline-offset-4 hover:no-underline"
          >
            Forgot password?
          </Link>
        </p>
      }
    >
      {reset === 'done' ? (
        <FormSuccess>Password changed. Sign in with the new one.</FormSuccess>
      ) : null}
      {email === 'changed' && !error ? (
        <FormSuccess>Email changed. Sign in with the new address.</FormSuccess>
      ) : null}
      {error ? (
        <FormAlert title="That link no longer works.">
          It has expired or was already used. Ask for a new one.
        </FormAlert>
      ) : null}
      <LoginForm siteKey={readTurnstileConfig().siteKey} />
    </AuthScreen>
  );
}
