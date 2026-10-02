import { z } from 'zod';

/**
 * A new admin password is longer than what sign-in accepts: admins approve
 * payments. Sign-in keeps 8 so an existing shorter password still works
 * (better-auth checks `minPasswordLength` on new passwords only; ADR-038).
 */
export const NEW_PASSWORD_MIN = 12;
/** better-auth's own ceiling; longer is refused there anyway. */
export const PASSWORD_MAX = 128;

/** Trimmed and lower-cased before the format check: " Raj@Example.com " is raj@example.com. */
const email = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address' }));

const newPassword = z
  .string({ error: 'Choose a new password' })
  .min(NEW_PASSWORD_MIN, { error: `Use at least ${NEW_PASSWORD_MIN} characters` })
  .max(PASSWORD_MAX, { error: `Use at most ${PASSWORD_MAX} characters` });

const currentPassword = z
  .string({ error: 'Enter your current password' })
  .min(1, { error: 'Enter your current password' });

/** Admin login input. */
export const loginSchema = z.object({
  email,
  password: z
    .string({ error: 'Password is required' })
    .min(8, { error: 'Password must be at least 8 characters' }),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** `create-admin`: a new account gets a new-password-strength password. */
export const newAdminSchema = z.object({ email, password: newPassword });

/** "Forgot password?" — only the address. */
export const forgotPasswordSchema = z.object({ email });

/** The page the emailed link opens: the token from the link, the new password twice. */
export const resetPasswordSchema = z
  .object({
    token: z
      .string({ error: 'This link is incomplete' })
      .min(1, { error: 'This link is incomplete' }),
    password: newPassword,
    confirm: z.string({ error: 'Type the new password again' }),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    error: 'The two passwords do not match',
  });

/** Change password while signed in. */
export const changePasswordSchema = z
  .object({
    current: currentPassword,
    password: newPassword,
    confirm: z.string({ error: 'Type the new password again' }),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    error: 'The two passwords do not match',
  })
  .refine((v) => v.password !== v.current, {
    path: ['password'],
    error: 'Choose a password different from the current one',
  });

/** Change email while signed in: the new address, proved by the current password. */
export const changeEmailSchema = z.object({ email, password: currentPassword });

/**
 * ADR-049: the six digits from the authenticator app. Spaces are dropped
 * (apps show "123 456"; phones paste it that way).
 */
export const totpCodeSchema = z
  .string({ error: 'Enter the 6-digit code from your authenticator app' })
  .transform((v) => v.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, { error: 'The code is 6 digits' }));

/**
 * A one-time backup code as better-auth issues it: "Ab3dE-9fGh2" (5, dash,
 * 5, letters and digits, case-sensitive). Surrounding spaces are dropped.
 */
export const backupCodeSchema = z
  .string({ error: 'Enter one of your backup codes' })
  .transform((v) => v.trim())
  .pipe(
    z.string().regex(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/, {
      error: 'A backup code looks like Ab3dE-9fGh2',
    }),
  );

/** First step of setting up 2FA: the current password, as better-auth requires. */
export const enableTwoFactorSchema = z.object({ password: currentPassword });

/** Second step: prove the app is set up by typing its current code. */
export const confirmTwoFactorSchema = z.object({ code: totpCodeSchema });
