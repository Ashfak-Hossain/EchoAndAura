import { nanoid } from 'nanoid';
import type { SponsorLogoExt } from '@/server/lib/sponsor-logo';

/**
 * Storage keys for sponsor logos (plan decision 1). The service creates the
 * sponsor's UUID before uploading, so the key carries its owner and a key
 * can be checked against the sponsor it is being saved on. Kept apart from
 * sponsor-logo.ts, which must stay import-free for the browser.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Objects for a sponsor live under one prefix so ownership is checkable. */
export function sponsorLogoPrefix(sponsorId: string): string {
  return `sponsors/${sponsorId}/`;
}

/** Fresh key per upload — replacing a logo never overwrites in place (no stale CDN copies). */
export function sponsorLogoKey(sponsorId: string, ext: SponsorLogoExt): string {
  // The id becomes a path segment; anything but a UUID could climb out of it.
  if (!UUID.test(sponsorId)) throw new RangeError(`sponsorId must be a UUID, got ${sponsorId}`);
  return `${sponsorLogoPrefix(sponsorId)}logo-${nanoid(12)}.${ext}`;
}

/** True only for keys this sponsor could have been issued: exact prefix, one segment, no traversal. */
export function isSponsorLogoKeyFor(key: string, sponsorId: string): boolean {
  if (!UUID.test(sponsorId)) return false;
  const prefix = sponsorLogoPrefix(sponsorId);
  if (!key.startsWith(prefix)) return false;
  return /^logo-[A-Za-z0-9_-]{12}\.(svg|png)$/.test(key.slice(prefix.length));
}
