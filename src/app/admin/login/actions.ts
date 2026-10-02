'use server';

import { APIError } from 'better-auth/api';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { HUMAN_CHECK_FAILED, passesHumanCheck } from '@/lib/human-check';
import { requestIp } from '@/lib/request-ip';
import { loginSchema } from '@/lib/validation/auth';
import {
  createRateLimiter,
  type RateLimitRule,
  redisRateLimitStore,
} from '@/server/lib/rate-limit';

export interface SignInState {
  error?: string;
  /** Echoed back on failure so the form keeps it; the password is never echoed. */
  email?: string;
  /**
   * The attempt never reached the password check (bot check, throttle):
   * the form shows `error` as written and marks neither field.
   */
  refused?: true;
}

/**
 * Brute-force guard. better-auth's own limiter (3 / 10 s on /sign-in)
 * runs only in its HTTP router; `auth.api.signInEmail` skips it, so this
 * form had none. Every attempt counts per IP; only wrong passwords count
 * per address, and per address *from that IP*. An address-wide count
 * would let anyone who passes Turnstile (a person, a solving service)
 * spend it with 5 wrong guesses and lock the real admin out of the
 * console from anywhere, right password or not. Redis down → allowed: an
 * admin must still get in during a blip, and Turnstile + the password
 * still stand. Off for the e2e suite (APP_ENV=test), which signs in as
 * the admin from six workers at once.
 */
const limiter = createRateLimiter(redisRateLimitStore(), { onError: 'allow' });
const LIMITS = {
  perIp: { limit: 10, windowSeconds: 60 },
  failedPerAddress: { limit: 5, windowSeconds: 15 * 60 },
};
// Not exported: a 'use server' module may export async functions only.
const TOO_MANY_SIGN_INS = 'Too many sign-in attempts. Please wait a few minutes and try again.';

function failedRule(ip: string, email: string): RateLimitRule {
  return { scope: 'admin-login:failed', subject: `${ip}:${email}`, ...LIMITS.failedPerAddress };
}

async function signInAllowed(ip: string, email: string): Promise<boolean> {
  if (process.env.APP_ENV === 'test') return true;
  // Both run: an attempt refused for its spent address still counts
  // against the IP that keeps trying.
  const [ipOk, failuresOk] = await Promise.all([
    limiter.allow([{ scope: 'admin-login:ip', subject: ip, ...LIMITS.perIp }]),
    limiter.check([failedRule(ip, email)]),
  ]);
  return ipOk && failuresOk;
}

async function countFailedSignIn(ip: string, email: string): Promise<void> {
  if (process.env.APP_ENV === 'test') return;
  await limiter.allow([failedRule(ip, email)]);
}

/**
 * Thin server action: Zod parse → human check (ADR-048) → throttle →
 * better-auth signInEmail → redirect. The nextCookies plugin on the auth
 * instance sets the session cookie.
 */
export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const rawEmail = formData.get('email');
  const email = typeof rawEmail === 'string' ? rawEmail : '';
  const parsed = loginSchema.safeParse({ email, password: formData.get('password') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input', email };
  }

  // Before the limiter: a bot's refused guesses spend nobody's budget.
  if (!(await passesHumanCheck(formData, 'admin-login'))) {
    return { error: HUMAN_CHECK_FAILED, email, refused: true };
  }
  const ip = await requestIp();
  if (!(await signInAllowed(ip, parsed.data.email))) {
    return { error: TOO_MANY_SIGN_INS, email, refused: true };
  }

  try {
    await auth.api.signInEmail({ body: parsed.data, headers: await headers() });
  } catch (err: unknown) {
    // Only a better-auth APIError means the credentials were actually rejected.
    // Deliberately generic so we never reveal whether an email is registered.
    if (err instanceof APIError) {
      await countFailedSignIn(ip, parsed.data.email);
      return { error: 'Invalid email or password', email };
    }
    // Anything else (DB unreachable, misconfiguration) is an infrastructure
    // failure — never disguise it as a bad password. Surface it distinctly.
    console.error('signInAction: unexpected error', err);
    return { error: 'Sign-in is temporarily unavailable. Please try again.', email };
  }

  // Outside the try: redirect() works by throwing and must not be swallowed.
  redirect('/admin');
}
