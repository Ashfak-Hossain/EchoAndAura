import {
  type RateLimiter,
  type RateLimitStore,
  createRateLimiter,
  redisRateLimitStore,
} from '@/server/lib/rate-limit';

/**
 * ADR-030 door API throttles. They FAIL OPEN: a Redis blip must never stop
 * a gate on the night, and none of them is the real defence — the 59-bit
 * pass code is (so the code-entry limit only keeps noise down), and every
 * scan is still one atomic, logged check-in. Search admits (a name, no
 * QR) get their own tighter budget: they are the easiest to abuse.
 */
export const DOOR_LIMITS = {
  /** Gate-code sign-in, per IP. */
  code: { scope: 'door-code:ip', limit: 20, windowSeconds: 600 },
  /** QR, typed or handheld scans, per pass. */
  scan: { scope: 'door-scan:pass', limit: 240, windowSeconds: 60 },
  /** Name-search admits, per pass (on top of `scan`). */
  searchAdmit: { scope: 'door-search-admit:pass', limit: 20, windowSeconds: 60 },
  /** Name searches, per pass. */
  search: { scope: 'door-search:pass', limit: 60, windowSeconds: 60 },
  /**
   * ADR-034 offline sync requests (up to 50 scans each), per pass. Counted
   * apart from `scan`: a phone back from an hour offline must be able to
   * empty its outbox without starving its own live scans.
   */
  sync: { scope: 'door-sync:pass', limit: 30, windowSeconds: 60 },
  /** Offline list downloads, per pass (the phone refreshes about once a minute). */
  list: { scope: 'door-list:pass', limit: 10, windowSeconds: 60 },
} as const;

export function createDoorLimiter(store: RateLimitStore = redisRateLimitStore()): RateLimiter {
  return createRateLimiter(store, { onError: 'allow' });
}
