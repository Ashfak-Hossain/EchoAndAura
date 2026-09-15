import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { LoginForm } from './login-form';

// TEMPORARY DEMO MARKUP — the real UI is designed separately (Claude Design).
export default async function AdminLoginPage() {
  // Already signed in? Skip the form.
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect('/admin');

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 p-4">
      <h1 className="text-xl font-semibold">Admin sign in</h1>
      <LoginForm />
    </main>
  );
}
