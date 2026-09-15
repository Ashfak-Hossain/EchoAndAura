'use server';

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
  } catch {
    // Deliberately generic so we never reveal whether an email is registered.
    return { error: 'Invalid email or password' };
  }

  // Outside the try: redirect() works by throwing and must not be swallowed.
  redirect('/admin');
}
