'use server';

import { APIError } from 'better-auth/api';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { requireAdmin } from '@/lib/session';
import {
  changeEmailSchema,
  changePasswordSchema,
  enableTwoFactorSchema,
} from '@/lib/validation/auth';
import { takeExposedAccountLink } from '@/server/auth/account-emails';
import { logger } from '@/server/lib/logger';
import { createRateLimiter, redisRateLimitStore } from '@/server/lib/rate-limit';
import { enqueueAccountEmail } from '@/server/queue/producer';

export interface ChangePasswordState {
  error?: string;
  field?: 'current' | 'password' | 'confirm';
}

export interface ChangeEmailState {
  error?: string;
  field?: 'email' | 'password';
  /** Echoed back so the form keeps it. */
  email?: string;
  /** Set once the confirmation was sent to the new address. */
  sentTo?: string;
  /** Dev/e2e only (E2E_EXPOSE_MAGIC_LINK=1): the confirmation link itself. */
  exposedLink?: string;
}

export interface BackupCodesState {
  error?: string;
  field?: 'password';
  /** The new codes, shown once; the old ones stopped working when these were made. */
  backupCodes?: string[];
}

/**
 * Per admin: a signed-in session must not be able to guess the current
 * password at speed (`auth.api` skips better-auth's own limiter).
 */
const limiter = createRateLimiter(redisRateLimitStore(), { onError: 'deny' });
const PER_ADMIN = { limit: 5, windowSeconds: 15 * 60 };

/**
 * Thin (ADR-038): admin → Zod → throttle → better-auth changePassword,
 * which checks the current password and signs out every other session.
 */
export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const admin = await requireAdmin();
  const parsed = changePasswordSchema.safeParse({
    current: formData.get('current'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const at = issue?.path[0];
    const field = at === 'current' || at === 'confirm' ? at : 'password';
    return { error: issue?.message ?? 'Check the passwords.', field };
  }
  if (!(await limiter.allow([{ scope: 'account:password', subject: admin.email, ...PER_ADMIN }]))) {
    return { error: 'Too many attempts. Please wait a few minutes and try again.' };
  }
  try {
    await auth.api.changePassword({
      headers: await headers(),
      body: {
        currentPassword: parsed.data.current,
        newPassword: parsed.data.password,
        revokeOtherSessions: true,
      },
    });
  } catch (err: unknown) {
    if (err instanceof APIError) {
      return { error: 'The current password is not right.', field: 'current' };
    }
    logger.error({ err: err instanceof Error ? err.message : err }, 'change password failed');
    return { error: 'The password could not be changed just now. Please try again in a minute.' };
  }
  logger.info({ admin: admin.email }, 'admin password changed');
  // better-auth replaced this browser's session too (revokeOtherSessions);
  // the new cookie counts from the next request. Rendering in this one would
  // still carry the old, deleted session and bounce through the login page.
  redirect('/admin/account?password=changed');
}

/**
 * Thin (ADR-038): admin → Zod → throttle → the current password proves
 * it is them → better-auth changeEmail (a link to the NEW address; the
 * change happens on the click) → a notice to the CURRENT address now,
 * before anything changes, so a stranger's attempt is seen in time.
 */
export async function changeEmailAction(
  _prev: ChangeEmailState,
  formData: FormData,
): Promise<ChangeEmailState> {
  const admin = await requireAdmin();
  const raw = formData.get('email');
  const typed = typeof raw === 'string' ? raw : '';
  const parsed = changeEmailSchema.safeParse({ email: typed, password: formData.get('password') });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0] === 'password' ? 'password' : 'email';
    return { error: issue?.message ?? 'Check the fields.', field, email: typed };
  }
  const { email: newEmail, password } = parsed.data;
  if (newEmail === admin.email) {
    return { error: 'That is already your email.', field: 'email', email: typed };
  }
  if (!(await limiter.allow([{ scope: 'account:email', subject: admin.email, ...PER_ADMIN }]))) {
    return { error: 'Too many attempts. Please wait a few minutes and try again.', email: typed };
  }
  const h = await headers();
  try {
    await auth.api.verifyPassword({ headers: h, body: { password } });
  } catch (err: unknown) {
    if (err instanceof APIError) {
      return { error: 'The password is not right.', field: 'password', email: typed };
    }
    logger.error({ err: err instanceof Error ? err.message : err }, 'verify password failed');
    return {
      error: 'The password could not be checked just now. Please try again in a minute.',
      email: typed,
    };
  }
  try {
    // Answers the same when the address belongs to someone else (nothing is sent then).
    await auth.api.changeEmail({
      headers: h,
      body: { newEmail, callbackURL: '/admin/login?email=changed' },
    });
  } catch (err: unknown) {
    logger.error({ err: err instanceof Error ? err.message : err }, 'change email failed');
    return {
      error: 'The confirmation could not be sent just now. Please try again in a minute.',
      email: typed,
    };
  }
  try {
    await enqueueAccountEmail({ kind: 'email-change-notice', to: admin.email, newEmail });
  } catch (err: unknown) {
    // The confirmation is queued; a lost notice must not hide that from the admin.
    logger.error(
      { err: err instanceof Error ? err.message : err },
      'email change notice not queued',
    );
  }
  logger.info({ admin: admin.email }, 'admin email change requested');
  return {
    sentTo: newEmail,
    exposedLink: takeExposedAccountLink('confirm-new-email', newEmail) ?? undefined,
  };
}

/**
 * Thin (ADR-049): admin → Zod → throttle → better-auth
 * generateBackupCodes, which checks the password and replaces every
 * stored code with ten new ones. The codes go back to the page once and
 * are never logged.
 */
export async function regenerateBackupCodesAction(
  _prev: BackupCodesState,
  formData: FormData,
): Promise<BackupCodesState> {
  const admin = await requireAdmin();
  const parsed = enableTwoFactorSchema.safeParse({ password: formData.get('password') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter your password', field: 'password' };
  }
  if (
    !(await limiter.allow([{ scope: 'account:backup-codes', subject: admin.email, ...PER_ADMIN }]))
  ) {
    return { error: 'Too many attempts. Please wait a few minutes and try again.' };
  }
  let backupCodes: string[];
  try {
    ({ backupCodes } = await auth.api.generateBackupCodes({
      headers: await headers(),
      body: { password: parsed.data.password },
    }));
  } catch (err: unknown) {
    if (err instanceof APIError && err.body?.code === 'INVALID_PASSWORD') {
      return { error: 'The password is not right.', field: 'password' };
    }
    logger.error(
      { err: err instanceof Error ? err.message : err },
      'backup code regeneration failed',
    );
    return { error: 'New codes could not be made just now. Please try again in a minute.' };
  }
  logger.info({ admin: admin.email }, 'admin backup codes regenerated');
  return { backupCodes };
}
