import { describe, expect, it } from 'vitest';
import { createInventoryService } from '@/server/services/inventory.service';
import { createOrdersService, summariseTotals } from '@/server/services/orders.service';
import { ordersSearchSchema } from '@/lib/validation/orders-search';
import { NOW, event, fakeDb, ticketType } from './helpers/fake-db';

describe('summariseTotals — the money rule', () => {
  it('revenue is paid + issued only; held, rejected, expired and cancelled never count', () => {
    const t = summariseTotals([
      { status: 'pending_payment', count: 3, totalPaisa: 300_000, compCount: 0 },
      { status: 'pending_verification', count: 2, totalPaisa: 200_000, compCount: 0 },
      { status: 'paid', count: 1, totalPaisa: 120_000, compCount: 0 },
      { status: 'issued', count: 4, totalPaisa: 480_000, compCount: 0 },
      { status: 'rejected', count: 1, totalPaisa: 120_000, compCount: 0 },
      { status: 'expired', count: 5, totalPaisa: 500_000, compCount: 0 },
      { status: 'cancelled', count: 1, totalPaisa: 120_000, compCount: 0 },
    ]);
    expect(t.count).toBe(17);
    expect(t.revenueCount).toBe(5);
    expect(t.revenuePaisa).toBe(600_000);
  });
  it('is zero for no orders', () => {
    expect(summariseTotals([])).toEqual({
      byStatus: [],
      count: 0,
      revenuePaisa: 0,
      revenueCount: 0,
      compCount: 0,
    });
  });
  // B13: a comp is issued but was never paid — B9 must not call it a paid order.
  it('comps are counted beside paid orders, never as one', () => {
    const t = summariseTotals([
      { status: 'issued', count: 6, totalPaisa: 480_000, compCount: 2 },
      { status: 'cancelled', count: 1, totalPaisa: 0, compCount: 1 },
    ]);
    expect(t).toMatchObject({ count: 7, revenueCount: 4, compCount: 2, revenuePaisa: 480_000 });
  });
});

describe('ordersService.orderTotals and sorted search (fake repo)', () => {
  async function setup() {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType({ quantityTotal: 50 })] });
    const orders = createOrdersService({
      orders: db.orders,
      tickets: db.tickets,
      events: db.events,
      ticketTypes: db.ticketTypes,
      inventory: createInventoryService(db.inventoryRepo),
      runInTransaction: db.runInTransaction,
      now: () => NOW,
    });
    const mk = (qty: number, email: string) =>
      orders.createOrder({
        eventSlug: 'live-dhaka',
        ticketTypeId: 'tt-1',
        quantity: qty,
        buyerName: 'Nusrat Jahan',
        buyerEmail: email,
        buyerPhone: '+8801712345678',
        attendeeNames: Array.from({ length: qty }, () => 'Nusrat Jahan'),
      });
    return { orders, mk };
  }

  it('totals ignore the status filter but honour the others', async () => {
    const { orders, mk } = await setup();
    await mk(1, 'a@example.com');
    const b = await mk(2, 'b@example.com');
    await orders.submitPayment(b.id, { trxId: 'TRX0000001', senderMsisdn: '+8801712345678' });

    const all = await orders.orderTotals(ordersSearchSchema.parse({ status: 'issued' }));
    expect(all.count).toBe(2);
    expect(all.byStatus.map((t) => t.status).sort()).toEqual([
      'pending_payment',
      'pending_verification',
    ]);
    expect(all.revenuePaisa).toBe(0);

    const onlyB = await orders.orderTotals(ordersSearchSchema.parse({ q: 'b@example' }));
    expect(onlyB.count).toBe(1);
  });

  it('sort=total:desc puts the biggest order first; default is newest first', async () => {
    const { orders, mk } = await setup();
    const small = await mk(1, 'a@example.com');
    const big = await mk(3, 'b@example.com');
    const byTotal = await orders.searchOrders(ordersSearchSchema.parse({ sort: 'total:desc' }));
    expect(byTotal.rows.map((r) => r.order.id)).toEqual([big.id, small.id]);
    const byTotalAsc = await orders.searchOrders(ordersSearchSchema.parse({ sort: 'total:asc' }));
    expect(byTotalAsc.rows.map((r) => r.order.id)).toEqual([small.id, big.id]);
    const bogus = await orders.searchOrders(ordersSearchSchema.parse({ sort: 'evil:asc' }));
    expect(bogus.rows.map((r) => r.order.id)).toEqual([big.id, small.id]); // newest first
  });
});
