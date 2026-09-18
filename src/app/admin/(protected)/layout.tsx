import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminShell } from '@/components/admin/admin-shell';
import { Button } from '@/components/ui/button';
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

  return (
    <AdminShell
      email={session.user.email}
      signOut={
        <form action={signOutAction}>
          <Button type="submit" variant="ghost" size="sm" className="-ml-2">
            Sign out
          </Button>
        </form>
      }
    >
      {children}
    </AdminShell>
  );
}
