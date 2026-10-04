import { describe, expect, it } from 'vitest';
import {
  HOLD_GRACE_MINUTES,
  HOLD_MINUTES,
  holdCutoff,
  holdEndsAt,
  holdLapsed,
  lapsedBefore,
} from '@/server/lib/hold';

/**
 * ADR-054: the buyer sees 20 minutes; the server takes a trxID for an
 * unannounced 2 more; only then is the hold lapsed. Every page, the expiry
 * job and the submit check read these, so the boundaries are pinned here.
 */
const CREATED = new Date('2026-09-20T10:00:00.000Z');
const ENDS = new Date('2026-09-20T10:20:00.000Z');
const CUTOFF = new Date('2026-09-20T10:22:00.000Z');

describe('the hold rule', () => {
  it('is 20 minutes plus a 2-minute grace', () => {
    expect(HOLD_MINUTES).toBe(20);
    expect(HOLD_GRACE_MINUTES).toBe(2);
  });

  it('holdEndsAt: 20 minutes after the order is made', () => {
    expect(holdEndsAt(CREATED)).toEqual(ENDS);
  });

  it('holdCutoff: 2 minutes after the clock the buyer saw', () => {
    expect(holdCutoff(ENDS)).toEqual(CUTOFF);
  });

  it('lapsedBefore: the hold end a lapsed hold must be older than, 2 minutes back', () => {
    expect(lapsedBefore(CUTOFF)).toEqual(ENDS);
    expect(lapsedBefore(new Date('2026-09-20T10:00:30.000Z'))).toEqual(
      new Date('2026-09-20T09:58:30.000Z'),
    );
  });

  it('does not mutate its inputs', () => {
    const at = new Date(CREATED);
    holdEndsAt(at);
    holdCutoff(at);
    lapsedBefore(at);
    expect(at).toEqual(CREATED);
  });
});

describe('holdLapsed', () => {
  const unpaid = { status: 'pending_payment', holdExpiresAt: ENDS };

  it('is false while the clock runs and inside the grace', () => {
    expect(holdLapsed(unpaid, CREATED)).toBe(false);
    expect(holdLapsed(unpaid, ENDS)).toBe(false);
    expect(holdLapsed(unpaid, new Date(ENDS.getTime() + 60_000))).toBe(false);
  });

  it('is false 1 ms before the cutoff', () => {
    expect(holdLapsed(unpaid, new Date(CUTOFF.getTime() - 1))).toBe(false);
  });

  it('is true exactly at the cutoff, and after it', () => {
    expect(holdLapsed(unpaid, CUTOFF)).toBe(true);
    expect(holdLapsed(unpaid, new Date(CUTOFF.getTime() + 86_400_000))).toBe(true);
  });

  // ADR-012: once a trxID is in, a person decides — it never lapses.
  it.each(['pending_verification', 'paid', 'issued', 'rejected', 'expired', 'cancelled'])(
    'is false for %s, however late',
    (status) => {
      expect(holdLapsed({ status, holdExpiresAt: ENDS }, new Date(CUTOFF.getTime() + 1))).toBe(
        false,
      );
    },
  );

  it('is false for an order with no hold (a comp)', () => {
    expect(holdLapsed({ status: 'pending_payment', holdExpiresAt: null }, CUTOFF)).toBe(false);
  });
});
