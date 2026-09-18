'use server';

import { APIError } from 'better-auth/api';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { loginSchema } from '@/lib/validation/auth';

export interface SignInState {
  error?: string;
  /** Echoed back on failure so the form keeps it; the password is never echoed. */
  email?: string;
}

/**
 * Thin server action: Zod parse → better-auth signInEmail → redirect.
 * The nextCookies plugin on the auth instance sets the session cookie.
 */
export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const rawEmail = formData.get('email');
  const email = typeof rawEmail === 'string' ? rawEmail : '';
  const parsed = loginSchema.safeParse({ email, password: formData.get('password') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input', email };
  }

  try {
    await auth.api.signInEmail({ body: parsed.data, headers: await headers() });
  } catch (err: unknown) {
    // Only a better-auth APIError means the credentials were actually rejected.
    // Deliberately generic so we never reveal whether an email is registered.
    if (err instanceof APIError) {
      return { error: 'Invalid email or password', email };
    }
    // Anything else (DB unreachable, misconfiguration) is an infrastructure
    // failure — never disguise it as a bad password. Surface it distinctly.
    console.error('signInAction: unexpected error', err);
    return { error: 'Sign-in is temporarily unavailable. Please try again.', email };
  }

  // Outside the try: redirect() works by throwing and must not be swallowed.
  redirect('/admin');
}
