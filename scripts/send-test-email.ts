/**
 * Mailer smoke test: `pnpm email:test you@example.com`. Sends a one-line
 * message through the mailer `MAILER` selects (`cloudflare` or `ses` to
 * prove a provider; the log mailer only writes to tmp/emails). Exits
 * non-zero on failure.
 */
import { selectMailer } from '@/server/email/select';

async function main(): Promise<void> {
  const to = process.argv[2];
  if (!to) throw new Error('usage: pnpm email:test <to-address>');
  const provider = process.env.MAILER ?? 'log';
  const mailer = selectMailer({ ...process.env, MAILER: provider });
  const { messageId } = await mailer.send({
    to,
    subject: 'echoandaura test email',
    html: '<p>If you can read this, the mailer is configured and DKIM is signing.</p>',
    text: 'If you can read this, the mailer is configured and DKIM is signing.',
  });
  console.log(`${provider} accepted the message: ${messageId}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
