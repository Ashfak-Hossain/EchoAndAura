import { describe, expect, it } from 'vitest';
import { loginSchema } from '@/lib/validation/auth';

describe('loginSchema', () => {
  it('accepts valid input and normalises the email', () => {
    const result = loginSchema.safeParse({
      email: '  Raj@Example.com ',
      password: 'correct-horse',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('raj@example.com');
    }
  });

  // Failure paths — every external input must be rejected, not coerced.
  it('rejects an invalid email', () => {
    expect(
      loginSchema.safeParse({
        email: 'not-an-email',
        password: 'correct-horse',
      }).success,
    ).toBe(false);
  });

  it('rejects a password shorter than 8 characters', () => {
    expect(loginSchema.safeParse({ email: 'raj@example.com', password: 'short' }).success).toBe(
      false,
    );
  });

  it('rejects missing fields', () => {
    expect(loginSchema.safeParse({}).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'raj@example.com' }).success).toBe(false);
    expect(loginSchema.safeParse({ password: 'correct-horse' }).success).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(loginSchema.safeParse({ email: 42, password: null }).success).toBe(false);
  });
});
