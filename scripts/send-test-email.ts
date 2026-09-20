/**
 * SES smoke test: `pnpm email:test you@example.com`. Sends a one-line
 * message through the configured mailer (MAILER=ses required to prove
 * SES; the log mailer only writes to tmp/emails). Exits non-zero on failure.
 */
import { createLogMailer } from '@/server/email/log-mailer';
import { readMailerEnv } from '@/server/email/mailer';
import { createSesMailer, readSesEnv } from '@/server/email/ses-mailer';

async function main(): Promise<void> {
  const to = process.argv[2];
  if (!to) throw new Error('usage: pnpm email:test <to-address>');
  const useSes = (process.env.MAILER ?? 'log') === 'ses';
  const mailer = useSes ? createSesMailer(readMailerEnv(), readSesEnv()) : createLogMailer();
  const { messageId } = await mailer.send({
    to,
    subject: 'echoandaura test email',
    html: '<p>If you can read this, SES is configured and DKIM is signing.</p>',
    text: 'If you can read this, SES is configured and DKIM is signing.',
  });
  console.log(`${useSes ? 'SES' : 'log mailer'} accepted the message: ${messageId}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
