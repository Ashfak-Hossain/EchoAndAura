import { z } from 'zod';

/**
 * Admin login input. Email is normalised (trimmed, lower-cased) before the
 * format check so " Raj@Example.com " and "raj@example.com" are the same user.
 */
export const loginSchema = z.object({
  email: z
    .string({ error: 'Email is required' })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Enter a valid email address' })),
  password: z
    .string({ error: 'Password is required' })
    .min(8, { error: 'Password must be at least 8 characters' }),
});

export type LoginInput = z.infer<typeof loginSchema>;
