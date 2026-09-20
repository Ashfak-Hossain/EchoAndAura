import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import MailComposer from 'nodemailer/lib/mail-composer';
import {
  type Mailer,
  type MailerEnv,
  MailerPermanentError,
  MailerThrottledError,
  type OutgoingEmail,
} from './mailer';

/**
 * Amazon SES adapter. Messages go out as raw MIME (built by nodemailer's
 * MailComposer) because the ticket email carries a PDF attachment, which
 * SES's "simple" content type cannot. The client is created lazily so the
 * app can build and run without SES credentials; only the worker sends.
 *
 * `FromEmailAddress` is passed alongside the raw message (it becomes the
 * envelope sender). SESv2 wants a non-ASCII display name there RFC 2047
 * encoded, which MailComposer does only inside the MIME — keep EMAIL_FROM's
 * display name ASCII (ENVIRONMENT.md).
 */
export interface SesEnv {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function readSesEnv(env: NodeJS.ProcessEnv = process.env): SesEnv {
  const region = env.AWS_SES_REGION?.trim();
  const accessKeyId = env.AWS_SES_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_SES_SECRET_ACCESS_KEY?.trim();
  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'AWS_SES_REGION / AWS_SES_ACCESS_KEY_ID / AWS_SES_SECRET_ACCESS_KEY are not set — see docs/ENVIRONMENT.md § Email',
    );
  }
  return { region, accessKeyId, secretAccessKey };
}

/** SES error names that mean "slow down", not "this message is wrong". */
const THROTTLE_NAMES = new Set([
  'Throttling',
  'ThrottlingException',
  'TooManyRequestsException',
  'SendingPausedException',
  // Daily quota: a retry in minutes will not help, but the message is fine.
  'LimitExceededException',
]);
/** SES error names that no retry will fix: the account or the message itself. */
const PERMANENT_NAMES = new Set([
  'MessageRejected',
  'MailFromDomainNotVerifiedException',
  'AccountSuspendedException',
  'BadRequestException',
  'NotFoundException',
]);

export interface SesSender {
  send(command: SendEmailCommand): Promise<{ MessageId?: string }>;
}

export async function buildRawMime(message: OutgoingEmail, env: MailerEnv): Promise<Buffer> {
  const composer = new MailComposer({
    from: env.from,
    to: message.to,
    replyTo: env.replyTo ?? undefined,
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: message.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  });
  return composer.compile().build();
}

export function createSesMailer(env: MailerEnv, ses: SesEnv, client?: SesSender): Mailer {
  let sender = client;
  const getClient = () =>
    (sender ??= new SESv2Client({
      region: ses.region,
      credentials: { accessKeyId: ses.accessKeyId, secretAccessKey: ses.secretAccessKey },
    }));

  return {
    async send(message: OutgoingEmail) {
      const raw = await buildRawMime(message, env);
      try {
        const out = await getClient().send(
          new SendEmailCommand({
            FromEmailAddress: env.from,
            Destination: { ToAddresses: [message.to] },
            ...(env.replyTo ? { ReplyToAddresses: [env.replyTo] } : {}),
            Content: { Raw: { Data: new Uint8Array(raw) } },
          }),
        );
        return { messageId: out.MessageId ?? 'unknown' };
      } catch (err: unknown) {
        const name = err instanceof Error ? err.name : '';
        if (THROTTLE_NAMES.has(name)) throw new MailerThrottledError(`SES ${name}`);
        if (PERMANENT_NAMES.has(name)) {
          throw new MailerPermanentError(`SES ${name}: ${err instanceof Error ? err.message : ''}`);
        }
        throw err;
      }
    },
  };
}
