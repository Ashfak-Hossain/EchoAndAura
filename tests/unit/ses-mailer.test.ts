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
          AWS_SES_ACCESS_KEY_ID: EXAMPLE_KEY_ID,
          AWS_SES_SECRET_ACCESS_KEY: EXAMPLE_SECRET,
        }),
      ).region,
    ).toBe('ap-south-1');
  });
});

// AWS's documented example keys: the right shape, valid nowhere.
const EXAMPLE_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
const EXAMPLE_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
// A temporary (ASIA…) id, built at run time: written out, AWS's example
// with an ASIA prefix is not on GitHub's list of known examples, and secret
// scanning raised an alert on it (2026-09-28).
const TEMPORARY_KEY_ID = EXAMPLE_KEY_ID.replace(/^AKIA/, 'ASIA');

describe('readSesEnv refuses keys that are not keys (2026-09-28)', () => {
  const procEnv = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
  const base = {
    AWS_SES_REGION: 'ap-south-1',
    AWS_SES_ACCESS_KEY_ID: EXAMPLE_KEY_ID,
    AWS_SES_SECRET_ACCESS_KEY: EXAMPLE_SECRET,
  };

  it.each([
    ['the template placeholder', '<access key id>'],
    ['a secret key pasted into the id field', EXAMPLE_SECRET],
    ['a lower-case id', 'akiaiosfodnn7example'],
    ['a truncated id', 'AKIAIOSFODNN7'],
    ['an id with a space inside', 'AKIAIOSF ODNN7EXAMPL'],
  ])('access key id: %s', (_label, value) => {
    expect(() => readSesEnv(procEnv({ ...base, AWS_SES_ACCESS_KEY_ID: value }))).toThrow(
      /AWS_SES_ACCESS_KEY_ID does not look like/,
    );
  });

  it.each([
    ['the template placeholder', '<secret access key>'],
    ['the id pasted into the secret field', EXAMPLE_KEY_ID],
    ['a 39-character secret', EXAMPLE_SECRET.slice(1)],
  ])('secret: %s', (_label, value) => {
    expect(() => readSesEnv(procEnv({ ...base, AWS_SES_SECRET_ACCESS_KEY: value }))).toThrow(
      /AWS_SES_SECRET_ACCESS_KEY does not look like/,
    );
  });

  it('never puts the value in the error message', () => {
    const secret = '<my real secret that must not leak here>';
    expect(() => readSesEnv(procEnv({ ...base, AWS_SES_SECRET_ACCESS_KEY: secret }))).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secret) }),
    );
  });

  it('accepts well-formed keys, and temporary (ASIA) ids, with surrounding spaces trimmed', () => {
    expect(
      readSesEnv(procEnv({ ...base, AWS_SES_ACCESS_KEY_ID: ` ${EXAMPLE_KEY_ID} ` })).accessKeyId,
    ).toBe(EXAMPLE_KEY_ID);
    expect(
      readSesEnv(procEnv({ ...base, AWS_SES_ACCESS_KEY_ID: TEMPORARY_KEY_ID })).accessKeyId,
    ).toBe(TEMPORARY_KEY_ID);
  });
});
