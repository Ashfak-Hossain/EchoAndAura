'use server';

import { APIError } from 'better-auth/api';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { requestIp } from '@/lib/request-ip';
import { backupCodeSchema, totpCodeSchema } from '@/lib/validation/auth';
import { logger } from '@/server/lib/logger';
import { createRateLimiter, redisRateLimitStore } from '@/server/lib/rate-limit';

export interface VerifyCodeState {
  error?: string;
  /** Which input the form showed, so a failed backup code keeps that input. */
  mode?: 'totp' | 'backup';
}

/**
 * better-auth bounds guessing per challenge (5 tries) and per account (10
 * wrong in a row → locked 15 minutes), but `auth.api` skips its HTTP
 * limiter, so nothing bounded one IP walking many challenges. Per IP only:
 * a per-account count would hand anyone who knows the password a way to
 * lock the admin out on top of better-auth's own lock. Redis down →
 * allowed, like the password step: better-auth's limits still stand. Off
 * for the e2e suite (APP_ENV=test), which signs in from many workers.
 */
const limiter = createRateLimiter(redisRateLimitStore(), { onError: 'allow' });
const PER_IP = { limit: 10, windowSeconds: 60 };

// Not exported: a 'use server' module may export async functions only.
const WRONG_CODE = 'That code is not right. Check the app and try again.';
const TOO_MANY = 'Too many attempts. Please wait a minute and try again.';
const LOCKED = 'Too many wrong codes. Two-factor sign-in is locked for 15 minutes.';
const UNAVAILABLE = 'Sign-in is temporarily unavailable. Please try again.';
/** The login page says "your sign-in timed out" for this. */
const EXPIRED_PATH = '/admin/login?expired=1';
/** …and "too many wrong codes for this sign-in" for this (expired-notice.ts). */
const SPENT_PATH = '/admin/login?expired=attempts';

async function verifyAllowed(): Promise<boolean> {
  if (process.env.APP_ENV === 'test') return true;
  return limiter.allow([{ scope: 'admin-2fa:ip', subject: await requestIp(), ...PER_IP }]);
}

function errorCode(err: APIError): string | undefined {
  const code: unknown = err.body?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Thin (ADR-049): Zod → throttle → better-auth verifyTOTP or
 * verifyBackupCode → /admin. better-auth reads its signed two-factor
 * challenge cookie (set by the password step), checks the code, and only
 * then creates the session; nextCookies sets it. The code is never logged.
 */
export async function verifyCodeAction(
  _prev: VerifyCodeState,
  formData: FormData,
): Promise<VerifyCodeState> {
  // The form sends one field or the other, depending on its toggle.
  const mode = formData.has('backupCode') ? 'backup' : 'totp';
  const parsed =
    mode === 'backup'
      ? backupCodeSchema.safeParse(formData.get('backupCode'))
      : totpCodeSchema.safeParse(formData.get('code'));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter the code', mode };
  }
  if (!(await verifyAllowed())) return { error: TOO_MANY, mode };

  try {
    const call = { body: { code: parsed.data }, headers: await headers() };
    if (mode === 'backup') await auth.api.verifyBackupCode(call);
    else await auth.api.verifyTOTP(call);
  } catch (err: unknown) {
    const code = err instanceof APIError ? errorCode(err) : undefined;
    if (code === 'INVALID_CODE' || code === 'INVALID_BACKUP_CODE') {
      return { error: WRONG_CODE, mode };
    }
    if (code === 'ACCOUNT_TEMPORARILY_LOCKED') return { error: LOCKED, mode };
    // The challenge is spent: 5 tries. better-auth refuses the 6th before
    // checking it, so even a right code lands here; say why, not "timed out".
    if (code === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE') redirect(SPENT_PATH);
    // Gone (10 minutes, or already used), or two-factor was reset with
    // admin:reset-2fa while this challenge was open (no secret, no codes):
    // only the password step helps, and after a reset it leads to setup.
    if (
      code === 'INVALID_TWO_FACTOR_COOKIE' ||
      code === 'TOTP_NOT_ENABLED' ||
      code === 'BACKUP_CODES_NOT_ENABLED'
    ) {
      redirect(EXPIRED_PATH);
    }
    // Anything else (DB unreachable) is not a wrong code; never disguise
    // it as one.
    logger.error(
      { err: err instanceof Error ? err.message : err, code, mode },
      'two-factor sign-in failed',
    );
    return { error: UNAVAILABLE, mode };
  }

  // Outside the try: redirect() works by throwing and must not be swallowed.
  redirect('/admin');
}
