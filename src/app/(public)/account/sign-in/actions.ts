'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { logger } from '@/server/lib/logger';
import { createRateLimiter, redisRateLimitStore } from '@/server/lib/rate-limit';
import { auth } from '@/lib/auth';
import { takeExposedMagicLink } from '@/server/auth/magic-link';
import { requestIp } from '@/lib/request-ip';
import { signInSchema } from '@/lib/validation/orders';

export interface SignInState {
  error?: string;
  /** Set once a link was requested; the page shows "check your inbox". */
  sentTo?: string;
  /** Dev/e2e only (E2E_EXPOSE_MAGIC_LINK=1): the link itself. */
  exposedLink?: string;
}

/**
 * Every link is an outbound email the client pays for, and better-auth's
 * own limiter covers only its HTTP handler, not `auth.api` calls — so the
 * throttle sits here: per IP and per address. Redis down → refused (the
 * email could not be queued either).
 */
const limiter = createRateLimiter(redisRateLimitStore(), { onError: 'deny' });
const SIGN_IN_LIMITS = {
  perIp: { limit: 10, windowSeconds: 60 },
  perEmail: { limit: 3, windowSeconds: 15 * 60 },
};

/** Thin: Zod → throttle → better-auth signInMagicLink → "check your inbox". The email goes through the worker. */
export async function requestSignInLinkAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = signInSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Enter your email.' };
  const { email } = parsed.data;
  const allowed = await limiter.allow([
    { scope: 'sign-in:ip', subject: await requestIp(), ...SIGN_IN_LIMITS.perIp },
    { scope: 'sign-in:email', subject: email, ...SIGN_IN_LIMITS.perEmail },
  ]);
  if (!allowed) {
    return { error: 'Too many sign-in requests. Please wait a few minutes and try again.' };
  }
  try {
    await auth.api.signInMagicLink({
      headers: await headers(),
      body: { email, callbackURL: '/account' },
    });
  } catch (err: unknown) {
    // Rate limited or infrastructure: say so plainly, never "sent".
    logger.warn({ err: err instanceof Error ? err.message : err }, 'sign-in link request failed');
    return { error: 'We could not send a sign-in link just now. Please try again in a minute.' };
  }
  const exposedLink = takeExposedMagicLink(email) ?? undefined;
  return { sentTo: email, exposedLink };
}

export async function signOutBuyerAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect('/');
}
