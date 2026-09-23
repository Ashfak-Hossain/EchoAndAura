import { describe, expect, it } from 'vitest';
import { PromoCodeNotValidError } from '@/server/lib/errors';
import type { PromoCodeRule } from '@/server/repositories/promo-codes.repository';
import { createInventoryService } from '@/server/services/inventory.service';
import { type CreateOrderInput, createOrdersService } from '@/server/services/orders.service';
import { NOW, event, fakeDb, ticketType } from './helpers/fake-db';

/**
 * B10 through createOrder with in-memory repositories: the discount comes
 * from the promo_codes row, never the caller (Invariant 5), and a code
 * that does not apply is refused BEFORE any stock is held.
 */
const DHAKA15: PromoCodeRule = {
  id: 'pc-1',
  code: 'DHAKA15',
  type: 'percentage',
  value: 15,
  active: true,
  ticketTypeIds: ['tt-1'],
};
const FLAT200: PromoCodeRule = {
  id: 'pc-2',
  code: 'FLAT200',
  type: 'fixed',
  value: 20_000,
  active: true,
  ticketTypeIds: [],
};
const OFF: PromoCodeRule = { ...DHAKA15, id: 'pc-3', code: 'OLD10', active: false };

function build(codes: PromoCodeRule[] = [DHAKA15, FLAT200, OFF]) {
  const db = fakeDb({
    events: [event()],
    ticketTypes: [ticketType(), ticketType({ id: 'tt-2', name: 'VIP', pricePaisa: 350_000 })],
  });
  const svc = createOrdersService({
    orders: db.orders,
    tickets: db.tickets,
    events: db.events,
    ticketTypes: db.ticketTypes,
    inventory: createInventoryService(db.inventoryRepo),
    promoCodes: {
      findByCode: async (code) => codes.find((c) => c.code === code) ?? null,
      findById: async (id) => codes.find((c) => c.id === id) ?? null,
    },
    runInTransaction: db.runInTransaction,
    now: () => NOW,
    reference: () => 'EA-PROMO1',
  });
  return { db, svc };
}

const input: CreateOrderInput = {
  eventSlug: 'live-dhaka',
  ticketTypeId: 'tt-1',
  quantity: 2,
  buyerName: 'Nusrat Jahan',
  buyerEmail: 'nusrat@example.com',
  buyerPhone: '+8801712345678',
  attendeeNames: ['Nusrat Jahan', 'Nusrat Jahan'],
};

describe('createOrder with a promo code', () => {
  it('prices from the code row, stores the code and names it in the audit row', async () => {
    const { db, svc } = build();
    const order = await svc.createOrder({ ...input, promoCode: 'dhaka15' });
    expect(order).toMatchObject({
      subtotalPaisa: 240_000,
      discountPaisa: 36_000,
      totalPaisa: 204_000,
      promoCodeId: 'pc-1',
    });
    expect(db.state.events[0]?.note).toContain('DHAKA15 −৳360.00');
    const view = await svc.getOrder(order.id);
    expect(view.promoCode).toBe('DHAKA15');
  });

  it('a fixed code is per ticket and an unrestricted code works on any type', async () => {
    const { svc } = build();
    const vip = await svc.createOrder({ ...input, ticketTypeId: 'tt-2', promoCode: 'FLAT200' });
    expect(vip).toMatchObject({
      subtotalPaisa: 700_000,
      discountPaisa: 40_000,
      totalPaisa: 660_000,
    });
  });

  it.each([
    ['NOPE', 'unknown'],
    // Switched off reads exactly like unknown: probing cannot tell them apart.
    ['OLD10', 'unknown'],
  ] as const)('refuses %s (%s) before holding anything', async (code, reason) => {
    const { db, svc } = build();
    const err = await svc.createOrder({ ...input, promoCode: code }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PromoCodeNotValidError);
    expect((err as PromoCodeNotValidError).reason).toBe(reason);
    expect(db.txCalls.started).toBe(0);
    expect(db.state.types.get('tt-1')?.quantityReserved).toBe(0);
    expect(db.state.orders).toHaveLength(0);
  });

  it('refuses a code restricted to another ticket type — never silently full price', async () => {
    const { db, svc } = build();
    const err = await svc
      .createOrder({ ...input, ticketTypeId: 'tt-2', promoCode: 'DHAKA15' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PromoCodeNotValidError);
    expect((err as PromoCodeNotValidError).reason).toBe('not_for_ticket_type');
    expect(db.txCalls.started).toBe(0);
    expect(db.state.types.get('tt-2')?.quantityReserved).toBe(0);
    expect(db.state.orders).toHaveLength(0);
  });

  it('refuses a code restricted only to another event as "unknown" — same as Apply', async () => {
    const { db, svc } = build([{ ...DHAKA15, ticketTypeIds: ['tt-elsewhere'] }]);
    const err = await svc.createOrder({ ...input, promoCode: 'DHAKA15' }).catch((e: unknown) => e);
    expect((err as PromoCodeNotValidError).reason).toBe('unknown');
    expect(db.txCalls.started).toBe(0);
  });

  it('refuses a code that would make the ticket free (a ৳0 order bKash cannot pay)', async () => {
    const BIG: PromoCodeRule = { ...FLAT200, id: 'pc-9', code: 'BIG', value: 500_000 };
    const { db, svc } = build([BIG]);
    const err = await svc.createOrder({ ...input, promoCode: 'BIG' }).catch((e: unknown) => e);
    expect((err as PromoCodeNotValidError).reason).toBe('makes_ticket_free');
    expect(db.txCalls.started).toBe(0);
    expect(db.state.types.get('tt-1')?.quantityReserved).toBe(0);
    expect(await svc.checkPromo('live-dhaka', 'BIG', 'tt-1')).toEqual({
      ok: false,
      reason: 'makes_ticket_free',
    });
  });

  it('without a code the order is full price and names no code', async () => {
    const { svc } = build();
    const order = await svc.createOrder(input);
    expect(order).toMatchObject({ discountPaisa: 0, totalPaisa: 240_000, promoCodeId: null });
    expect((await svc.getOrder(order.id)).promoCode).toBeNull();
  });
});

describe('checkPromo (Apply)', () => {
  it('returns the rule scoped to this event', async () => {
    const { svc } = build();
    expect(await svc.checkPromo('live-dhaka', 'dhaka15', 'tt-1')).toEqual({
      ok: true,
      code: 'DHAKA15',
      type: 'percentage',
      value: 15,
      ticketTypeIds: ['tt-1'],
      label: '15% off',
    });
    expect(await svc.checkPromo('live-dhaka', 'FLAT200', 'tt-2')).toMatchObject({
      ok: true,
      ticketTypeIds: [],
      label: '৳200.00 off each ticket',
    });
  });

  it('says why a code cannot be used', async () => {
    const { svc } = build();
    expect(await svc.checkPromo('live-dhaka', 'NOPE', 'tt-1')).toEqual({
      ok: false,
      reason: 'unknown',
    });
    expect(await svc.checkPromo('live-dhaka', 'OLD10', 'tt-1')).toEqual({
      ok: false,
      reason: 'unknown',
    });
    expect(await svc.checkPromo('live-dhaka', 'DHAKA15', 'tt-2')).toEqual({
      ok: false,
      reason: 'not_for_ticket_type',
    });
    expect(await svc.checkPromo('no-such-event', 'DHAKA15', 'tt-1')).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('a code restricted only to another event is "not valid for this event"', async () => {
    const { svc } = build([{ ...DHAKA15, ticketTypeIds: ['tt-elsewhere'] }]);
    expect(await svc.checkPromo('live-dhaka', 'DHAKA15', 'tt-1')).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });
});
