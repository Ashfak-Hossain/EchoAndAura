/**
 * ADR-054: the inventory hold on a new order. Pure (no next/*, no node:*):
 * the orders service, the expiry job, the order page, the buyer's account
 * page and the public copy all read the rule from here, so the clock the
 * buyer sees and the cutoff the server enforces can never drift apart.
 *
 * The buyer sees HOLD_MINUTES counting down to `holdExpiresAt`. A trxID is
 * still accepted for HOLD_GRACE_MINUTES after that, unannounced: a slow last
 * tap, a phone clock a minute out, a page that never refreshed. Only then is
 * the hold lapsed — the order page shows "expired", the expiry job releases
 * the seats, and a late trxID is refused. Once a trxID is in
 * (`pending_verification`) nothing expires: a person decides (ADR-012).
 */

/** The hold the buyer is told about and sees counting down. */
export const HOLD_MINUTES = 20;

/** Accepted after the clock reaches zero, never shown to the buyer. */
export const HOLD_GRACE_MINUTES = 2;

const MINUTE_MS = 60_000;

/** When a hold made at `createdAt` ends on the buyer's clock. */
export function holdEndsAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + HOLD_MINUTES * MINUTE_MS);
}

/** The moment the server stops accepting a trxID and may release the seats. */
export function holdCutoff(holdExpiresAt: Date): Date {
  return new Date(holdExpiresAt.getTime() + HOLD_GRACE_MINUTES * MINUTE_MS);
}

/**
 * The latest `holdExpiresAt` that is lapsed at `at`: what the repository
 * queries compare with — lapsed: `hold_expires_at <= lapsedBefore(at)`;
 * still live: `hold_expires_at > lapsedBefore(at)`.
 */
export function lapsedBefore(at: Date): Date {
  return new Date(at.getTime() - HOLD_GRACE_MINUTES * MINUTE_MS);
}

/**
 * An unpaid order whose hold has lapsed at `at` — even if the expiry job has
 * not flipped it to `expired` yet. Any other status never lapses here.
 */
export function holdLapsed(
  order: { status: string; holdExpiresAt: Date | null },
  at: Date,
): boolean {
  return (
    order.status === 'pending_payment' &&
    order.holdExpiresAt !== null &&
    at.getTime() >= holdCutoff(order.holdExpiresAt).getTime()
  );
}
