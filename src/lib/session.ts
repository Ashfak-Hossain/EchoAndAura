import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import type { Role } from '@/lib/auth-options';

export interface PublicSession {
  email: string;
  name: string;
  role: Role;
}

/**
 * The signed-in user, for server components and actions. Buyers and the
 * admin share better-auth; `role` is what separates them. Returns null for
 * anonymous visitors (the normal case on the public site). Memoised per
 * request: the public layout and the page both ask, and each lookup is a
 * DB round trip.
 */
export const getPublicSession = cache(async (): Promise<PublicSession | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const raw = (session.user as { role?: unknown }).role;
  const role: Role = raw === 'admin' ? 'admin' : 'buyer';
  return { email: session.user.email.toLowerCase(), name: session.user.name, role };
});

/**
 * The admin, or a redirect. Every admin server action calls this itself:
 * the (protected) layout guards page renders only, and a server action is
 * its own POST endpoint — a buyer's session (free to obtain by magic link)
 * must never get to approve an order because "a session exists".
 */
export async function requireAdmin(): Promise<PublicSession> {
  const session = await getPublicSession();
  if (!session) redirect('/admin/login');
  if (session.role !== 'admin') redirect('/');
  return session;
}
