'use server';

import { APIError } from 'better-auth/api';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { loginSchema } from '@/lib/validation/auth';

export interface SignInState {
  error?: string;
}

/**
 * Thin server action: Zod parse → better-auth signInEmail → redirect.
 * The nextCookies plugin on the auth instance sets the session cookie.
 */
export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  try {
    await auth.api.signInEmail({ body: parsed.data, headers: await headers() });
  } catch (err: unknown) {
    // Only a better-auth APIError means the credentials were actually rejected.
    // Deliberately generic so we never reveal whether an email is registered.
    if (err instanceof APIError) {
      return { error: 'Invalid email or password' };
    }
    // Anything else (DB unreachable, misconfiguration) is an infrastructure
    // failure — never disguise it as a bad password. Surface it distinctly.
    console.error('signInAction: unexpected error', err);
    return { error: 'Sign-in is temporarily unavailable. Please try again.' };
  }

  // Outside the try: redirect() works by throwing and must not be swallowed.
  redirect('/admin');
}
