import { headers } from 'next/headers';

/**
 * The caller's IP for rate-limit keys. Behind the reverse proxy it is the
 * first hop of X-Forwarded-For; locally (no proxy) every request shares
 * one bucket, which is fine for dev and e2e. Not for security decisions —
 * only for throttling.
 */
export async function requestIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || h.get('x-real-ip')?.trim() || 'unknown';
}
