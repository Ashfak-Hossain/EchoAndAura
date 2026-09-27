import type { ReactNode } from 'react';
import { ActiveSectionTitle, AdminNav } from './admin-nav';
import type { NavCounts } from './nav-items';
import { EnvChip } from './env-chip';
import { MobileNav } from './mobile-nav';

interface Props {
  email: string;
  counts?: NavCounts;
  /** Sidebar/sheet sign-out: quiet text link (B2 footer). */
  signOutQuiet: ReactNode;
  /** Header sign-out: outlined 36px button (B2 header). */
  signOutButton: ReactNode;
  children: ReactNode;
}

/**
 * B2 to the pixel: charcoal sidebar 240 (padding 18/14, 44px rows), white
 * header 64 with the section title, env chip, email and an outlined Sign out;
 * content on the page ground, fluid to 1440 with 24px gutters. Under 1024px
 * the sidebar becomes MobileNav's sheet and the header shrinks to 56.
 */
export function AdminShell({ email, counts, signOutQuiet, signOutButton, children }: Props) {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar px-3.5 py-4.5 text-sidebar-foreground lg:flex print:hidden">
        <span className="px-2 pb-4.5 font-heading text-lg font-semibold tracking-tight text-sidebar-accent-foreground">
          echoandaura
        </span>
        <AdminNav counts={counts} />
        <div className="mt-auto flex flex-col gap-1.5 border-t border-sidebar-border px-2 pt-3 text-[13px]">
          <span className="truncate text-sidebar-accent-foreground" title={email}>
            {email}
          </span>
          {signOutQuiet}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-border bg-card px-3 lg:h-16 lg:px-6 print:hidden">
          <div className="flex items-center gap-3">
            <div className="lg:hidden">
              <MobileNav email={email} counts={counts} signOut={signOutQuiet} />
            </div>
            <h1 className="font-heading text-[17px] font-semibold tracking-tight lg:text-xl">
              <ActiveSectionTitle />
            </h1>
          </div>
          <div className="flex items-center gap-3.5">
            <EnvChip />
            <span className="hidden text-sm text-muted-foreground lg:inline">
              <span className="sr-only">Signed in as </span>
              {email}
            </span>
            <div className="hidden lg:block">{signOutButton}</div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-360 flex-1 p-4 lg:p-6 print:p-0">{children}</main>
      </div>
    </div>
  );
}
