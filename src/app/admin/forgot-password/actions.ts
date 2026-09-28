'use server';

import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { requestIp } from '@/lib/request-ip';
import { forgotPasswordSchema } from '@/lib/validation/auth';
import { takeExposedAccountLink } from '@/server/auth/account-emails';
import { logger } from '@/server/lib/logger';
import { createRateLimiter, redisRateLimitStore } from '@/server/lib/rate-limit';

export interface ForgotPasswordState {
  error?: string;
  /** Echoed back so the form keeps it. */
  email?: string;
  /** Set once a reset was requested; the page shows "if it is an admin, check your inbox". */
  sentTo?: string;
  /** Dev/e2e only (E2E_EXPOSE_MAGIC_LINK=1): the link itself. */
  exposedLink?: string;
}

/**
 * Each request can be an email to an admin's inbox, and `auth.api` calls
 * skip better-auth's own limiter: throttled here, per IP and per address.
 * Redis down → refused (the email could not be queued either).
 */
const limiter = createRateLimiter(redisRateLimitStore(), { onError: 'deny' });
const LIMITS = {
  perIp: { limit: 10, windowSeconds: 60 },
  perEmail: { limit: 3, windowSeconds: 15 * 60 },
};

/**
 * Thin (ADR-038): Zod → throttle → better-auth requestPasswordReset → the
 * same answer whether or not the address is an admin's. Only an admin's
 * gets the email (sendPasswordReset); the link opens /admin/reset-password.
 */
export async function requestPasswordResetAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const raw = formData.get('email');
  const typed = typeof raw === 'string' ? raw : '';
  const parsed = forgotPasswordSchema.safeParse({ email: typed });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter your email.', email: typed };
  }
  const { email } = parsed.data;
  const allowed = await limiter.allow([
    { scope: 'password-reset:ip', subject: await requestIp(), ...LIMITS.perIp },
    { scope: 'password-reset:email', subject: email, ...LIMITS.perEmail },
  ]);
  if (!allowed) {
    return { error: 'Too many reset requests. Please wait a few minutes and try again.', email };
  }
  try {
    await auth.api.requestPasswordReset({
      headers: await headers(),
      body: { email, redirectTo: '/admin/reset-password' },
    });
  } catch (err: unknown) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'password reset request failed');
    return {
      error: 'We could not send a reset link just now. Please try again in a minute.',
      email,
    };
  }
  return {
    sentTo: email,
    exposedLink: takeExposedAccountLink('password-reset', email) ?? undefined,
  };
}
