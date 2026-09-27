import { headers } from 'next/headers';
import { clientIpFromForwardedFor } from '@/lib/client-ip';

/**
 * The caller's IP for rate-limit keys: the visitor Cloudflare saw, read
 * from the right of X-Forwarded-For (ADR-037). Not X-Real-Ip: Traefik sets
 * it to Cloudflare's edge, never the visitor. Locally (no proxy) every
 * request shares one bucket, which is fine for dev and e2e. Not for
 * security decisions — only for throttling.
 */
export async function requestIp(): Promise<string> {
  const h = await headers();
  return clientIpFromForwardedFor(h.get('x-forwarded-for')) ?? 'unknown';
}
