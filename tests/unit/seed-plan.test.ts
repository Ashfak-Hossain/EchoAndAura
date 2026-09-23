import { addHours } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { MAX_TICKETS_PER_ORDER } from '@/server/lib/order-rules';
import { buildSeedPlan } from '../../scripts/seed/plan';

/**
 * The dev seed runs its plan through the real services, which refuse
 * anything unbuyable — so the plan itself must be buyable at every moment
 * it names. Checked here for a few different "nows" (the plan is relative).
 */
const NOWS = [
  new Date('2026-09-24T04:30:00Z'), // 10:30 Dhaka
  new Date('2026-09-24T18:05:00Z'), // 00:05 Dhaka, just after midnight
  new Date('2027-02-10T12:00:00Z'),
];

describe.each(NOWS)('buildSeedPlan(%s)', (now) => {
  const plan = buildSeedPlan(now);
  const eventOf = (key: string) => plan.events.find((e) => e.key === key)!;
  const typeOf = (eventKey: string, typeKey: string) =>
    eventOf(eventKey).ticketTypes.find((t) => t.key === typeKey)!;

  it('every order is placed inside its registration and sales window, never in the future', () => {
    for (const o of plan.orders) {
      const e = eventOf(o.eventKey);
      const t = typeOf(o.eventKey, o.typeKey);
      const when = `${o.eventKey}/${o.typeKey} ${o.story} at ${o.createdAt.toISOString()}`;
      expect(o.createdAt <= now, when).toBe(true);
      if (o.story === 'comp') continue; // comps are the organizer's call — no window
      expect(
        o.createdAt >= e.registrationOpensAt && o.createdAt <= e.registrationClosesAt,
        when,
      ).toBe(true);
      if (t.salesStartsAt) expect(o.createdAt >= t.salesStartsAt, when).toBe(true);
      if (t.salesEndsAt) expect(o.createdAt <= t.salesEndsAt, when).toBe(true);
      expect(o.quantity).toBeGreaterThanOrEqual(1);
      expect(o.quantity).toBeLessThanOrEqual(MAX_TICKETS_PER_ORDER);
    }
  });

  it('each step follows the last, inside the 24 h hold, and before now', () => {
    for (const o of plan.orders) {
      if (o.submittedAt) {
        expect(o.submittedAt > o.createdAt).toBe(true);
        expect(o.submittedAt < addHours(o.createdAt, 24)).toBe(true);
        expect(o.submittedAt <= now).toBe(true);
        expect(o.trxId).toMatch(/^[A-Z0-9]{10}$/);
      }
      if (o.decidedAt && o.story !== 'comp') {
        expect(o.decidedAt > o.submittedAt!).toBe(true);
        expect(o.decidedAt <= now).toBe(true);
      }
      if (o.cancelledAt) expect(o.cancelledAt > o.decidedAt! && o.cancelledAt <= now).toBe(true);
      if (o.story === 'expired') expect(addHours(o.createdAt, 24) < now).toBe(true);
      if (o.story === 'pending_payment') expect(addHours(o.createdAt, 24) > now).toBe(true);
    }
  });

  it('never oversells; Poetry & Pints sells out exactly', () => {
    const used = new Map<string, number>();
    for (const o of plan.orders) {
      const k = `${o.eventKey}:${o.typeKey}`;
      used.set(k, (used.get(k) ?? 0) + o.quantity);
    }
    for (const e of plan.events) {
      for (const t of e.ticketTypes) {
        expect(used.get(`${e.key}:${t.key}`) ?? 0).toBeLessThanOrEqual(t.quantityTotal);
      }
    }
    expect(used.get('poetry:general')).toBe(60);
    expect(
      plan.orders.filter((o) => o.eventKey === 'poetry').every((o) => o.story === 'issued'),
    ).toBe(true);
    expect(used.get('live:early')).toBe(typeOf('live', 'early').quantityTotal);
  });

  it('codes land only where they apply, and never make a ticket free', () => {
    for (const o of plan.orders.filter((x) => x.promoCode)) {
      const promo = plan.promos.find((p) => p.code === o.promoCode)!;
      expect(promo.active).toBe(true);
      if (promo.restrictTo.length > 0) {
        expect(promo.restrictTo).toContainEqual({ eventKey: o.eventKey, typeKey: o.typeKey });
      }
      const price = typeOf(o.eventKey, o.typeKey).pricePaisa;
      const off =
        promo.type === 'percentage' ? Math.floor((price * promo.value) / 100) : promo.value;
      expect(off).toBeLessThan(price);
    }
  });

  it('tells every story, fills the queue, and shows every public phase', () => {
    const stories = new Set(plan.orders.map((o) => o.story));
    for (const s of [
      'issued',
      'pending_verification',
      'pending_payment',
      'rejected',
      'expired',
      'comp',
      'cancel_one',
    ]) {
      expect(stories.has(s as never), s).toBe(true);
    }
    const queue = plan.orders.filter(
      (o) => o.eventKey === 'live' && o.story === 'pending_verification',
    );
    expect(queue).toHaveLength(5);
    const expiringSoon = plan.orders.filter(
      (o) =>
        o.story === 'pending_payment' &&
        addHours(o.createdAt, 24).getTime() - now.getTime() < 2 * 3_600_000,
    );
    expect(expiringSoon.length).toBeGreaterThanOrEqual(1);

    const live = eventOf('live');
    expect(live.registrationOpensAt < now && now < live.registrationClosesAt).toBe(true);
    const closing = eventOf('monsoon').registrationClosesAt.getTime() - now.getTime();
    expect(closing > 0 && closing < 48 * 3_600_000).toBe(true);
    expect(eventOf('winter').registrationOpensAt > now).toBe(true);
    expect(eventOf('spring').startsAt < now && eventOf('spring').archiveAt! < now).toBe(true);
    expect(eventOf('monsoon')).toMatchObject({ venueHidden: true, venueArea: 'Banani, Dhaka' });
  });

  it('is deterministic for a given now', () => {
    expect(JSON.stringify(buildSeedPlan(now))).toBe(JSON.stringify(plan));
  });
});
