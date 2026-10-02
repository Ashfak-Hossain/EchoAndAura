'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

/**
 * Also the setup page's sign-out (ADR-049): no `requireAdmin()` here, so an
 * admin who has not set up two-factor yet can still leave.
 */
export async function signOutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect('/admin/login');
}
