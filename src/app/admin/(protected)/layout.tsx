import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
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

  // TEMPORARY DEMO SHELL — the real admin layout is designed separately.
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="font-semibold">echoandaura admin</span>
        <form action={signOutAction}>
          <button type="submit" className="text-sm underline">
            Sign out
          </button>
        </form>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}
