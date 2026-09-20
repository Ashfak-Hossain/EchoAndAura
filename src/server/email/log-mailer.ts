import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@/server/lib/logger';
import type { Mailer, OutgoingEmail } from './mailer';

/**
 * Local / test adapter: logs the send and drops the HTML (and any
 * attachment) into `tmp/emails/` so a developer can open what a buyer
 * would have received. Never used in production (the worker refuses).
 */
export function createLogMailer(dir = path.join(process.cwd(), 'tmp', 'emails')): Mailer {
  let n = 0;
  return {
    async send(message: OutgoingEmail) {
      const messageId = `log-${Date.now()}-${++n}`;
      const base = path.join(dir, `${messageId}`);
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(`${base}.html`, message.html);
        await writeFile(`${base}.txt`, message.text);
        for (const a of message.attachments ?? []) {
          await writeFile(path.join(dir, `${messageId}-${a.filename}`), a.content);
        }
      } catch (err: unknown) {
        // A read-only filesystem must not stop the "send".
        logger.warn({ err }, 'log-mailer: could not write preview files');
      }
      logger.info(
        { subject: message.subject, messageId, attachments: message.attachments?.length ?? 0 },
        'email (log mailer)',
      );
      logger.debug({ to: message.to, messageId }, 'email (log mailer) recipient');
      return { messageId };
    },
  };
}
