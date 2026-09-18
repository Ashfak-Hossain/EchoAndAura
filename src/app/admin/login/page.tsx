import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

// B1: centred card on the page ground. Wordmark + "Organizer console" set the
// context; the form itself is all logic lives in ./actions.ts.
export default async function AdminLoginPage() {
  // Already signed in? Skip the form.
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect('/admin');

  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-1">
          <span className="font-heading text-lg font-semibold tracking-tight">echoandaura</span>
          <h1 className="text-3xl">Organizer console</h1>
          <p className="text-sm text-muted-foreground">
            Payments, tickets and the door list for Echo &amp; Aura events.
          </p>
          <p className="mt-1 text-xs tracking-[0.08em] text-muted-foreground uppercase">
            Staff only · all actions are logged against your email
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Use the email the console was set up with.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Forgotten the password? It can only be reset from the server — see{' '}
          <span className="font-medium text-foreground">docs/ENVIRONMENT.md</span>.
        </p>
      </div>
    </main>
  );
}
