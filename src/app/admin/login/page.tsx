import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

// B1: split screen — charcoal brand panel (420px) on the left, the form
// centred on the right. Under lg the panel becomes a compact header block.
export default async function AdminLoginPage() {
  // Already signed in? Skip the form.
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect('/admin');

  return (
    <main className="flex min-h-screen flex-col lg:flex-row">
      <aside className="flex flex-col justify-between gap-10 bg-foreground px-6 py-8 text-background lg:w-105 lg:shrink-0 lg:px-10 lg:py-10">
        <span className="font-heading text-2xl font-semibold tracking-tight">echoandaura</span>
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl leading-[1.15] tracking-[-0.02em] text-background">
            Organizer console
          </h1>
          <p className="text-[15px] leading-relaxed text-border-strong">
            Payments, tickets and the door list for Echo &amp; Aura events.
          </p>
        </div>
        <p className="hidden font-mono text-xs leading-relaxed text-muted-foreground lg:block">
          Staff only · all actions are logged against your email
        </p>
      </aside>

      <section className="flex flex-1 items-center justify-center px-6 py-12 lg:px-10">
        <div className="flex w-full max-w-95 flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-2xl">Sign in</h2>
            <p className="text-sm text-muted-foreground">
              Use the email the console was set up with.
            </p>
          </div>

          <LoginForm />

          <p className="text-xs leading-relaxed text-muted-foreground">
            Forgotten the password? It can only be reset from the server.
          </p>
        </div>
      </section>
    </main>
  );
}
