import { describe, expect, it } from 'vitest';
import { emailKindOf, selectMailer } from '@/server/email/select';

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe('selectMailer', () => {
  it('refuses a non-SES mailer in production and defaults to log elsewhere', () => {
    expect(() => selectMailer(env({ NODE_ENV: 'production', MAILER: 'log' }))).toThrow(
      /MAILER=log/,
    );
    // Production without SES env fails on the missing credentials, never silently.
    expect(() => selectMailer(env({ NODE_ENV: 'production' }))).toThrow(/EMAIL_FROM|AWS_SES/);
    expect(selectMailer(env({ NODE_ENV: 'development' }))).toBeTruthy();
  });
});

describe('emailKindOf', () => {
  it('maps job names to kinds and ignores everything else', () => {
    expect(emailKindOf('email.tickets-issued')).toBe('tickets-issued');
    expect(emailKindOf('email.nope')).toBeNull();
    expect(emailKindOf('expire-holds')).toBeNull();
  });
});
