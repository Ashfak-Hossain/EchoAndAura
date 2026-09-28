import { describe, expect, it } from 'vitest';
import {
  changeEmailSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  NEW_PASSWORD_MIN,
  newAdminSchema,
  resetPasswordSchema,
} from '@/lib/validation/auth';

const GOOD = 'a-long-new-password';
const issue = (r: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => r.error?.issues[0];

describe('new passwords (ADR-038)', () => {
  it('sign-in still accepts an existing 8-character password; new ones need 12', () => {
    const eight = 'abcdefgh';
    expect(loginSchema.safeParse({ email: 'raj@example.com', password: eight }).success).toBe(true);
    expect(newAdminSchema.safeParse({ email: 'raj@example.com', password: eight }).success).toBe(
      false,
    );
    expect(NEW_PASSWORD_MIN).toBe(12);
  });

  it('newAdminSchema: 12 is enough, 11 is not, 129 is too long', () => {
    const ok = (password: string) =>
      newAdminSchema.safeParse({ email: 'a@b.co', password }).success;
    expect(ok('x'.repeat(12))).toBe(true);
    expect(ok('x'.repeat(11))).toBe(false);
    expect(ok('x'.repeat(129))).toBe(false);
  });
});

describe('forgotPasswordSchema', () => {
  it('normalises the address', () => {
    const r = forgotPasswordSchema.safeParse({ email: '  Raj@Example.COM ' });
    expect(r.success && r.data.email).toBe('raj@example.com');
  });
  it.each([[''], ['not-an-email'], [undefined], [42]])('rejects %j', (email) => {
    expect(forgotPasswordSchema.safeParse({ email }).success).toBe(false);
  });
});

describe('resetPasswordSchema', () => {
  const base = { token: 'tok', password: GOOD, confirm: GOOD };
  it('accepts a token and two matching passwords', () => {
    expect(resetPasswordSchema.safeParse(base).success).toBe(true);
  });
  it('rejects a missing or empty token (a mangled link)', () => {
    expect(issue(resetPasswordSchema.safeParse({ ...base, token: '' }))?.path).toEqual(['token']);
    expect(resetPasswordSchema.safeParse({ ...base, token: undefined }).success).toBe(false);
  });
  it('rejects a short password, on the password field', () => {
    const r = resetPasswordSchema.safeParse({ ...base, password: 'short', confirm: 'short' });
    expect(issue(r)?.path).toEqual(['password']);
  });
  it('rejects a mismatch, on the confirm field', () => {
    const r = resetPasswordSchema.safeParse({ ...base, confirm: `${GOOD}!` });
    expect(issue(r)).toMatchObject({
      path: ['confirm'],
      message: 'The two passwords do not match',
    });
  });
});

describe('changePasswordSchema', () => {
  const base = { current: 'the-old-password', password: GOOD, confirm: GOOD };
  it('accepts a different new password typed twice', () => {
    expect(changePasswordSchema.safeParse(base).success).toBe(true);
  });
  it('requires the current password', () => {
    expect(issue(changePasswordSchema.safeParse({ ...base, current: '' }))?.path).toEqual([
      'current',
    ]);
  });
  it('rejects a new password equal to the current one', () => {
    const same = { current: GOOD, password: GOOD, confirm: GOOD };
    expect(issue(changePasswordSchema.safeParse(same))).toMatchObject({ path: ['password'] });
  });
  it('rejects a mismatch and a short password', () => {
    expect(
      issue(changePasswordSchema.safeParse({ ...base, confirm: 'other-password-x' }))?.path,
    ).toEqual(['confirm']);
    expect(
      changePasswordSchema.safeParse({ ...base, password: 'short', confirm: 'short' }).success,
    ).toBe(false);
  });
});

describe('changeEmailSchema', () => {
  it('normalises the new address and needs the current password', () => {
    const r = changeEmailSchema.safeParse({ email: ' New@Example.com', password: 'x' });
    expect(r.success && r.data.email).toBe('new@example.com');
    expect(
      issue(changeEmailSchema.safeParse({ email: 'new@example.com', password: '' }))?.path,
    ).toEqual(['password']);
  });
  it('rejects an invalid address', () => {
    expect(issue(changeEmailSchema.safeParse({ email: 'nope', password: 'x' }))?.path).toEqual([
      'email',
    ]);
  });
});
