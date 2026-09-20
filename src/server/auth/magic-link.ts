import { logger } from '@/server/lib/logger';

/** Magic links live this long (seconds). */
export const MAGIC_LINK_TTL_SECONDS = 15 * 60;

export interface MagicLinkDeps {
  roleOf: (email: string) => Promise<string | null>;
  enqueue: (to: string, url: string) => Promise<void>;
  env?: NodeJS.ProcessEnv;
}

/**
 * The magic-link sender: hands the link to the email queue (Invariant 7 —
 * nothing here waits on a mail provider). Admins sign in with a password
 * only, so an admin-role email is silently skipped — the endpoint still
 * answers "sent", which keeps admin emails unenumerable.
 */
export async function sendMagicLink(
  { email, url }: { email: string; url: string },
  deps: MagicLinkDeps,
): Promise<void> {
  const role = await deps.roleOf(email);
  if (role === 'admin') {
    logger.warn({ email }, 'magic link requested for an admin email — not sent');
    return;
  }
  exposeForTests(email, url, deps.env);
  await deps.enqueue(email, url);
}

/**
 * Test seam: with E2E_EXPOSE_MAGIC_LINK=1 the last link per email is kept
 * in memory so the sign-in page can show it and Playwright can follow it.
 * Positive gate: only APP_ENV=test (the Playwright web server sets it) —
 * a staging or production deployment that inherits the flag by accident
 * still never shows a link, and NODE_ENV plays no part because `next
 * start` forces it to production even for the e2e build.
 */
const exposedLinks = new Map<string, string>();
export function magicLinksExposed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.APP_ENV === 'test' && env.E2E_EXPOSE_MAGIC_LINK === '1';
}
function exposeForTests(email: string, url: string, env?: NodeJS.ProcessEnv): void {
  if (magicLinksExposed(env)) exposedLinks.set(email, url);
}
export function takeExposedMagicLink(email: string, env?: NodeJS.ProcessEnv): string | null {
  if (!magicLinksExposed(env)) return null;
  const url = exposedLinks.get(email) ?? null;
  exposedLinks.delete(email);
  return url;
}
