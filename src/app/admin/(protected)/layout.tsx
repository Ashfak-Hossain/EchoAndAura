import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ordersService } from '@/server/container';
import { AdminShell } from '@/components/admin/admin-shell';
import { auth } from '@/lib/auth';
import { signOutAction } from './actions';

/**
 * Authoritative guard for everything under /admin (except /admin/login, which
 * sits outside this route group). This is a real DB-backed session check;
 * src/proxy.ts only does a fast optimistic cookie check before it.
 */
export default async function AdminProtectedLayout({ children }: { children: ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/admin/login');
  // The one live badge the design allows (B2): what is waiting for a person.
  const verification = await ordersService.countPendingVerification();

  return (
    <AdminShell
      email={session.user.email}
      counts={{ verification }}
      signOutQuiet={
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-left text-[13px] text-[#a8a29a] hover:text-sidebar-accent-foreground"
          >
            Sign out
          </button>
        </form>
      }
      signOutButton={
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex h-9 items-center rounded-lg border border-border-strong bg-card px-3.5 text-[13px] font-semibold hover:bg-secondary"
          >
            Sign out
          </button>
        </form>
      }
    >
      {children}
    </AdminShell>
  );
}
