/**
 * Seeds the single admin account.
 *
 * Public sign-up is disabled in the app, so this script builds its own auth
 * instance with sign-up allowed and calls the public signUpEmail API — the
 * password is hashed by better-auth and no internal APIs are touched.
 *
 *   pnpm admin:create <email> <password> [name]
 */
import { betterAuth } from 'better-auth';
import { queryClient } from '@/db/client';
import { buildAuthOptions } from '@/lib/auth-options';
import { loginSchema } from '@/lib/validation/auth';

async function main(): Promise<void> {
  const [email, password, name = 'Admin'] = process.argv.slice(2);

  const parsed = loginSchema.safeParse({ email, password });
  if (!parsed.success) {
    console.error('Usage: pnpm admin:create <email> <password> [name]');
    console.error(parsed.error.issues[0]?.message ?? 'Invalid input');
    process.exitCode = 1;
    return;
  }

  const seedAuth = betterAuth(buildAuthOptions({ disableSignUp: false }));
  try {
    const { user } = await seedAuth.api.signUpEmail({
      body: { email: parsed.data.email, password: parsed.data.password, name },
    });
    console.log(`Created admin ${user.email} (${user.id})`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to create admin: ${message}`);
    process.exitCode = 1;
  }
}

main().finally(() => queryClient.end());
