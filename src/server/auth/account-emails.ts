import { logger } from '@/server/lib/logger';
import { magicLinksExposed } from './magic-link';

/** Reset and email-change links live this long (seconds). */
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;
export const EMAIL_CHANGE_TTL_SECONDS = 60 * 60;

/**
 * The three admin account emails (ADR-038). Each is a job payload, so it
 * crosses Redis: the worker parses it again, never trusts it.
 */
export type AccountEmail =
  | { kind: 'password-reset'; to: string; url: string }
  /** Sent to the NEW address; the change happens only when it is clicked. */
  | { kind: 'confirm-new-email'; to: string; url: string }
  /** Sent to the CURRENT address at the moment of the request, before anything changes. */
  | { kind: 'email-change-notice'; to: string; newEmail: string };

export type AccountEmailKind = AccountEmail['kind'];

export interface AccountEmailDeps {
  roleOf: (email: string) => Promise<string | null>;
  enqueue: (email: AccountEmail) => Promise<void>;
  env?: NodeJS.ProcessEnv;
}

/**
 * better-auth's `sendResetPassword`. Buyers sign in by magic link and have
 * no password: a reset for them would give them a second way in, so only
 * an admin address gets the email. The endpoint answers the same either
 * way, which keeps admin addresses unenumerable.
 */
export async function sendPasswordReset(
  { email, url }: { email: string; url: string },
  deps: AccountEmailDeps,
): Promise<void> {
  if ((await deps.roleOf(email)) !== 'admin') {
    logger.warn('password reset requested for a non-admin address — not sent');
    return;
  }
  exposeForTests('password-reset', email, url, deps.env);
  await deps.enqueue({ kind: 'password-reset', to: email, url });
}

/**
 * better-auth's `sendVerificationEmail`. It is used only by the email
 * change (sign-up verification is off and buyers verify by magic link), so
 * `newEmail` is the address being moved to and `role` is the signed-in
 * user's. Anyone but an admin is refused, as a second lock behind the
 * account page.
 */
export async function sendNewEmailConfirmation(
  { newEmail, role, url }: { newEmail: string; role: unknown; url: string },
  deps: Pick<AccountEmailDeps, 'enqueue' | 'env'>,
): Promise<void> {
  if (role !== 'admin') {
    logger.warn('email change confirmation for a non-admin session — not sent');
    return;
  }
  exposeForTests('confirm-new-email', newEmail, url, deps.env);
  await deps.enqueue({ kind: 'confirm-new-email', to: newEmail, url });
}

/**
 * Test seam, gated exactly like the magic link (APP_ENV=test and
 * E2E_EXPOSE_MAGIC_LINK=1): the last link per kind and address is kept in
 * memory so the page can show it and Playwright can follow it.
 */
const exposed = new Map<string, string>();
const key = (kind: AccountEmailKind, email: string) => `${kind} ${email.toLowerCase()}`;
function exposeForTests(
  kind: AccountEmailKind,
  email: string,
  url: string,
  env?: NodeJS.ProcessEnv,
) {
  if (magicLinksExposed(env)) exposed.set(key(kind, email), url);
}
export function takeExposedAccountLink(
  kind: AccountEmailKind,
  email: string,
  env?: NodeJS.ProcessEnv,
): string | null {
  if (!magicLinksExposed(env)) return null;
  const url = exposed.get(key(kind, email)) ?? null;
  exposed.delete(key(kind, email));
  return url;
}
