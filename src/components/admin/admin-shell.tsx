import type { ReactNode } from 'react';
import { AdminNav } from './admin-nav';
import { EnvChip } from './env-chip';
import { MobileNav } from './mobile-nav';

interface Props {
  email: string;
  /** The sign-out form (a server action) rendered by the layout. */
  signOut: ReactNode;
  children: ReactNode;
}

/**
 * B2: sidebar 240 on the page ground, header with environment chip and the
 * signed-in email, content fluid to 1440 with 24px gutters. Under 1024px the
 * sidebar collapses into MobileNav's sheet.
 */
export function AdminShell({ email, signOut, children }: Props) {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar px-4 py-6 lg:flex">
        <span className="px-3 font-heading text-lg font-semibold tracking-tight">echoandaura</span>
        <AdminNav />
        <div className="mt-auto flex flex-col gap-2 border-t border-sidebar-border pt-4 text-sm">
          <span className="truncate px-3 text-muted-foreground" title={email}>
            {email}
          </span>
          <div className="px-3">{signOut}</div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-border bg-background px-4 lg:px-6">
          <div className="flex items-center gap-2">
            <div className="lg:hidden">
              <MobileNav email={email} signOut={signOut} />
            </div>
            <span className="font-heading text-lg font-semibold tracking-tight lg:hidden">
              echoandaura
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <EnvChip />
            <span className="hidden text-muted-foreground lg:inline">
              <span className="sr-only">Signed in as </span>
              {email}
            </span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 lg:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
