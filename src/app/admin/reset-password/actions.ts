'use server';

import { APIError } from 'better-auth/api';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { requestIp } from '@/lib/request-ip';
import { resetPasswordSchema } from '@/lib/validation/auth';
import { logger } from '@/server/lib/logger';
import { createRateLimiter, redisRateLimitStore } from '@/server/lib/rate-limit';

export interface ResetPasswordState {
  error?: string;
  /** Which field the error belongs to. */
  field?: 'password' | 'confirm';
  /** The link itself is dead: expired, used, or never valid. */
  linkDead?: boolean;
}

const limiter = createRateLimiter(redisRateLimitStore(), { onError: 'deny' });
const PER_IP = { limit: 10, windowSeconds: 60 };

/**
 * Thin (ADR-038): Zod → throttle → better-auth resetPassword, which checks
 * the token, saves the password and (revokeSessionsOnPasswordReset) signs
 * the account out everywhere → the sign-in page.
 */
export async function resetPasswordAction(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === 'token') return { linkDead: true, error: issue.message };
    const field = issue?.path[0] === 'confirm' ? 'confirm' : 'password';
    return { error: issue?.message ?? 'Check the new password.', field };
  }
  if (
    !(await limiter.allow([
      { scope: 'password-reset:set:ip', subject: await requestIp(), ...PER_IP },
    ]))
  ) {
    return { error: 'Too many attempts. Please wait a minute and try again.' };
  }
  try {
    await auth.api.resetPassword({
      body: { token: parsed.data.token, newPassword: parsed.data.password },
    });
  } catch (err: unknown) {
    if (err instanceof APIError) {
      return { linkDead: true, error: 'This link has expired or was already used.' };
    }
    logger.error({ err: err instanceof Error ? err.message : err }, 'password reset failed');
    return { error: 'The password could not be saved just now. Please try again in a minute.' };
  }
  // Outside the try: redirect() works by throwing.
  redirect('/admin/login?reset=done');
}
