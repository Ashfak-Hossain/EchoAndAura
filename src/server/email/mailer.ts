/**
 * The outbound email port. Services never send (Invariant 7) — they hand
 * the worker a job, and the worker hands the rendered message to whichever
 * adapter the environment selects (`log` locally and in tests, `ses` in
 * production).
 */
export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative; every message has one. */
  text: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export interface Mailer {
  /** Resolves with the provider's message id. Throws MailerThrottledError to ask for a retry. */
  send(message: OutgoingEmail): Promise<{ messageId: string }>;
}

/** The provider asked us to slow down; the job is retried with backoff. */
export class MailerThrottledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailerThrottledError';
  }
}

/** The provider will never accept this message as-is; retrying is pointless. */
export class MailerPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailerPermanentError';
  }
}

export interface MailerEnv {
  /** "echoandaura <tickets@echoandaura.com>" */
  from: string;
  /** Where buyer replies land (Cloudflare Email Routing → the organizer). */
  replyTo: string | null;
}

export function readMailerEnv(env: NodeJS.ProcessEnv = process.env): MailerEnv {
  const from = env.EMAIL_FROM?.trim();
  if (!from) throw new Error('EMAIL_FROM is not set — see docs/ENVIRONMENT.md § Email');
  return { from, replyTo: env.EMAIL_REPLY_TO?.trim() || null };
}
