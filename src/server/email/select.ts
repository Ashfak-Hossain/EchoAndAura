import { EMAIL_JOB_PREFIX } from '@/server/queue/names';
import { logger } from '@/server/lib/logger';
import { createLogMailer } from './log-mailer';
import { type Mailer, readMailerEnv } from './mailer';
import { createSesMailer, readSesEnv } from './ses-mailer';
import { EMAIL_KINDS, type EmailKind } from './templates/render';

/**
 * Which adapter sends, from `MAILER`. Production refuses anything but SES:
 * a "log" send is not a send, and a misconfigured VPS must fail on boot,
 * not silently drop every ticket email into a tmp folder.
 */
export function selectMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  const choice = env.MAILER ?? (env.NODE_ENV === 'production' ? 'ses' : 'log');
  if (choice === 'ses') return createSesMailer(readMailerEnv(env), readSesEnv(env));
  if (env.NODE_ENV === 'production') {
    throw new Error(`MAILER=${choice} is not allowed in production — set MAILER=ses`);
  }
  logger.warn({ mailer: choice }, 'using the log mailer: emails are written to tmp/emails, not sent');
  return createLogMailer();
}

/** `email.<kind>` → kind, or null for any other job name. */
export function emailKindOf(jobName: string): EmailKind | null {
  if (!jobName.startsWith(EMAIL_JOB_PREFIX)) return null;
  const kind = jobName.slice(EMAIL_JOB_PREFIX.length);
  return (EMAIL_KINDS as readonly string[]).includes(kind) ? (kind as EmailKind) : null;
}
