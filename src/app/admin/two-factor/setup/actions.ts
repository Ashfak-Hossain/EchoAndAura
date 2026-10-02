'use server';

import { APIError } from 'better-auth/api';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { requestIp } from '@/lib/request-ip';
import { requireAdminPendingTwoFactor } from '@/lib/session';
import { confirmTwoFactorSchema, enableTwoFactorSchema } from '@/lib/validation/auth';
import { logger } from '@/server/lib/logger';
import { authenticatorQrSvg } from '@/server/lib/qr';
import { createRateLimiter, redisRateLimitStore } from '@/server/lib/rate-limit';
import { adminAccountsRepository } from '@/server/repositories/admin-accounts.repository';

export interface StartSetupState {
  error?: string;
  field?: 'password';
  /**
   * The new, not yet confirmed factor. `qr` and `secret` are the same
   * thing twice (the otpauth URI as an image, its key as text); the raw
   * URI never leaves the server. The codes are shown only once the first
   * app code is confirmed.
   */
  setup?: { qr: string; secret: string; backupCodes: string[] };
}

export interface ConfirmSetupState {
  error?: string;
  /**
   * The factor is gone (admin:reset-2fa mid-setup): back to the password.
   * Rare: the reset also ends this session. Another tab re-running step 1
   * does not land here; it replaces the secret, so this tab's code is
   * simply wrong (INVALID_CODE).
   */
  restart?: true;
  done?: true;
}

/**
 * Per IP, shared by both steps: a wrong code at setup costs better-auth
 * nothing (its attempt counter and lockout apply to sign-in only), so this
 * is the only brake on guessing here. Redis down → allowed: an admin must
 * still be able to finish setup during a blip, and the session and the
 * password still stand. Off for the e2e suite (APP_ENV=test), which sets
 * up from six workers on one IP.
 */
const limiter = createRateLimiter(redisRateLimitStore(), { onError: 'allow' });
const PER_IP = { limit: 10, windowSeconds: 60 };
const TOO_MANY = 'Too many attempts. Please wait a minute and try again.';
const UNAVAILABLE = 'Two-factor setup is not available just now. Please try again in a minute.';
const SETUP_WRONG_CODE =
  'That code is not right. Use the code for the QR on this page (delete any older echoandaura entry in the app), and check the time on your phone.';

async function setupAllowed(): Promise<boolean> {
  if (process.env.APP_ENV === 'test') return true;
  return limiter.allow([{ scope: 'admin-2fa-setup:ip', subject: await requestIp(), ...PER_IP }]);
}

/** The URI as an <img> data URL: rendered here, so the client needs no QR library. */
async function qrDataUrl(totpURI: string): Promise<string> {
  const svg = await authenticatorQrSvg(totpURI);
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/**
 * Step 1 (ADR-049): admin → Zod → throttle → better-auth enableTwoFactor,
 * which checks the password and stores a new, unverified secret and codes
 * (replacing any unfinished attempt) → QR + key + codes back to the page.
 * Never logs the secret or the codes.
 */
export async function startSetupAction(
  _prev: StartSetupState,
  formData: FormData,
): Promise<StartSetupState> {
  const admin = await requireAdminPendingTwoFactor();
  if (admin.twoFactorEnabled) redirect('/admin');
  const parsed = enableTwoFactorSchema.safeParse({ password: formData.get('password') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter your password', field: 'password' };
  }
  if (!(await setupAllowed())) return { error: TOO_MANY };

  let totpURI: string | undefined;
  let backupCodes: string[] | undefined;
  let alreadyOn = false;
  try {
    const res = await auth.api.enableTwoFactor({
      body: { password: parsed.data.password },
      headers: await headers(),
    });
    // 'otp' (email codes) is never asked for and not configured.
    if (res.method === 'totp') ({ totpURI, backupCodes } = res);
  } catch (err: unknown) {
    const code = err instanceof APIError ? err.body?.code : undefined;
    if (code === 'INVALID_PASSWORD') {
      return { error: 'That password is not right', field: 'password' };
    }
    if (code === 'TOTP_ALREADY_ENABLED') {
      alreadyOn = true;
    } else {
      logger.error({ err: err instanceof Error ? err.message : err }, 'two-factor enable failed');
      return { error: UNAVAILABLE };
    }
  }
  // Outside the try: redirect() works by throwing and must not be swallowed.
  if (alreadyOn) redirect('/admin');

  const secret = totpURI ? new URL(totpURI).searchParams.get('secret') : null;
  if (!totpURI || !secret || !backupCodes?.length) {
    logger.error('two-factor enable returned no authenticator secret');
    return { error: UNAVAILABLE };
  }
  logger.info({ admin: admin.email }, 'admin two-factor setup started');
  return { setup: { qr: await qrDataUrl(totpURI), secret, backupCodes } };
}

/**
 * Step 2: admin → Zod → throttle → better-auth verifyTOTP. With a session
 * (no sign-in challenge) a right code marks the factor verified, turns
 * two-factor on and replaces the session; nextCookies sets the new cookie.
 * Then every older session of this admin is revoked.
 */
export async function confirmSetupAction(
  _prev: ConfirmSetupState,
  formData: FormData,
): Promise<ConfirmSetupState> {
  const admin = await requireAdminPendingTwoFactor();
  if (admin.twoFactorEnabled) redirect('/admin');
  const parsed = confirmTwoFactorSchema.safeParse({ code: formData.get('code') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter the 6-digit code' };
  }
  if (!(await setupAllowed())) return { error: TOO_MANY };

  // Taken before the call: the session better-auth creates on success is
  // newer, so only the ones that never passed a code fall before it.
  const before = new Date();
  let userId: string;
  try {
    const res = await auth.api.verifyTOTP({
      body: { code: parsed.data.code },
      headers: await headers(),
    });
    userId = res.user.id;
  } catch (err: unknown) {
    const code = err instanceof APIError ? err.body?.code : undefined;
    if (code === 'INVALID_CODE') {
      // A second run of step 1 (reload, another tab) replaced the secret:
      // an entry scanned earlier makes wrong codes, so say which QR counts.
      return { error: SETUP_WRONG_CODE };
    }
    if (code === 'TOTP_NOT_ENABLED') {
      return { error: 'This setup is no longer current. Start again.', restart: true };
    }
    logger.error({ err: err instanceof Error ? err.message : err }, 'two-factor confirm failed');
    return { error: UNAVAILABLE };
  }
  // better-auth swapped only this session. requireAdmin() reads the
  // account-level flag, so every other session of this admin (another
  // device, a pre-0024 one, one opened with the password during setup)
  // would now pass it without ever giving a code. End them.
  try {
    const revoked = await adminAccountsRepository.revokeSessionsCreatedBefore(userId, before);
    logger.info({ admin: admin.email, revoked }, 'admin two-factor turned on');
  } catch (err: unknown) {
    // Two-factor is on either way; the codes must still be shown. Loud, so
    // someone signs the other devices out by hand (a password change).
    logger.error(
      { err: err instanceof Error ? err.message : err, admin: admin.email },
      'two-factor on, but older sessions were not revoked',
    );
  }
  return { done: true };
}
