import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { describe, expect, it, vi } from 'vitest';
import { MailerPermanentError, MailerThrottledError, readMailerEnv } from '@/server/email/mailer';
import { buildRawMime, createSesMailer, readSesEnv } from '@/server/email/ses-mailer';

const env = { from: 'echoandaura <tickets@echoandaura.com>', replyTo: 'hello@echoandaura.com' };
const ses = { region: 'ap-south-1', accessKeyId: 'AKIA', secretAccessKey: 'secret' };
const message = {
  to: 'nusrat@example.com',
  subject: 'Your 2 tickets',
  html: '<p>Hello</p>',
  text: 'Hello',
  attachments: [
    {
      filename: 'tickets-EA-1.pdf',
      content: Buffer.from('%PDF-1.4 fake'),
      contentType: 'application/pdf',
    },
  ],
};

describe('ses mailer', () => {
  it('sends raw MIME with from, reply-to, both bodies and the attachment', async () => {
    const send = vi.fn<(cmd: SendEmailCommand) => Promise<{ MessageId?: string }>>(async () => ({
      MessageId: 'ses-123',
    }));
    const mailer = createSesMailer(env, ses, { send });
    const out = await mailer.send(message);
    expect(out).toEqual({ messageId: 'ses-123' });
    const cmd = send.mock.calls[0]![0];
    expect(cmd).toBeInstanceOf(SendEmailCommand);
    expect(cmd.input.FromEmailAddress).toBe(env.from);
    expect(cmd.input.Destination?.ToAddresses).toEqual(['nusrat@example.com']);
    expect(cmd.input.ReplyToAddresses).toEqual(['hello@echoandaura.com']);
    const raw = Buffer.from(cmd.input.Content!.Raw!.Data!).toString();
    expect(raw).toContain('Subject: Your 2 tickets');
    expect(raw).toContain('Content-Type: text/plain');
    expect(raw).toContain('Content-Type: text/html');
    expect(raw).toContain('Content-Type: application/pdf');
    expect(raw).toContain('filename=tickets-EA-1.pdf');
  });

  it('maps throttling to a retry, permanent rejections to no retry, and passes the unknown through', async () => {
    const named = (name: string) => Object.assign(new Error(`SES says ${name}`), { name });
    const failing = (err: Error) =>
      createSesMailer(env, ses, {
        send: vi.fn(async () => {
          throw err;
        }),
      });
    await expect(failing(named('TooManyRequestsException')).send(message)).rejects.toBeInstanceOf(
      MailerThrottledError,
    );
    await expect(failing(named('LimitExceededException')).send(message)).rejects.toBeInstanceOf(
      MailerThrottledError,
    );
    await expect(failing(named('MessageRejected')).send(message)).rejects.toBeInstanceOf(
      MailerPermanentError,
    );
    await expect(
      failing(named('MailFromDomainNotVerifiedException')).send(message),
    ).rejects.toBeInstanceOf(MailerPermanentError);
    const weird = named('SomethingNew');
    await expect(failing(weird).send(message)).rejects.toBe(weird);
  });

  it('builds a MIME message without reply-to or attachments when absent', async () => {
    const raw = (
      await buildRawMime({ ...message, attachments: undefined }, { from: env.from, replyTo: null })
    ).toString();
    expect(raw).not.toContain('Reply-To');
    expect(raw).not.toContain('application/pdf');
  });

  const procEnv = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

  it('reads and validates the environment', () => {
    expect(readMailerEnv(procEnv({ EMAIL_FROM: 'a@b.c' }))).toEqual({
      from: 'a@b.c',
      replyTo: null,
    });
    expect(() => readMailerEnv(procEnv({}))).toThrow(/EMAIL_FROM/);
    expect(() => readSesEnv(procEnv({ AWS_SES_REGION: 'x' }))).toThrow(/AWS_SES/);
    expect(
      readSesEnv(
        procEnv({
          AWS_SES_REGION: 'ap-south-1',
          AWS_SES_ACCESS_KEY_ID: 'k',
          AWS_SES_SECRET_ACCESS_KEY: 's',
        }),
      ).region,
    ).toBe('ap-south-1');
  });
});
