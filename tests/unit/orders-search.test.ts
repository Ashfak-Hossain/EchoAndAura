import { describe, expect, it } from 'vitest';
import { csvField, toCsv } from '@/server/lib/csv';
import { formatDecimalBDT } from '@/server/lib/money';
import { createInventoryService } from '@/server/services/inventory.service';
import {
  createOrdersService,
  matchedField,
  ORDERS_PAGE_SIZE,
} from '@/server/services/orders.service';
import { normaliseSearchTerm, ordersSearchSchema } from '@/lib/validation/orders-search';
import { NOW, event, fakeDb, ticketType } from './helpers/fake-db';

describe('ordersSearchSchema — lenient URL state', () => {
  it('defaults everything and clamps the page', () => {
    expect(ordersSearchSchema.parse({})).toEqual({
      q: '',
      status: null,
      event: null,
      from: null,
      to: null,
      page: 1,
    });
    expect(ordersSearchSchema.parse({ page: '0' }).page).toBe(1);
    expect(ordersSearchSchema.parse({ page: 'x' }).page).toBe(1);
    expect(ordersSearchSchema.parse({ page: '7' }).page).toBe(7);
  });

  it('drops an unknown status, a non-uuid event and a malformed date instead of failing', () => {
    const r = ordersSearchSchema.parse({
      status: 'bogus',
      event: 'not-a-uuid',
      from: '2026-9-1',
      to: '2026-09-17',
      q: '  EA-7K3M9Q  ',
    });
    expect(r.status).toBeNull();
    expect(r.event).toBeNull();
    expect(r.from).toBeNull();
    expect(r.to).toBe('2026-09-17');
    expect(r.q).toBe('EA-7K3M9Q');
    expect(ordersSearchSchema.parse({ status: 'issued' }).status).toBe('issued');
  });
});

describe('normaliseSearchTerm — the term is normalised like the stored data', () => {
  it('reference: any case, with or without EA-', () => {
    for (const raw of ['ea-7k3m9q', 'EA7K3M9Q', ' 7K3M9Q ']) {
      expect(normaliseSearchTerm(raw).reference).toBe('EA-7K3M9Q');
    }
    expect(normaliseSearchTerm('7K3M9').reference).toBeNull();
  });

  it('trxID: exactly ten alphanumerics, upper-cased', () => {
    expect(normaliseSearchTerm('9ab12cd34e').trxId).toBe('9AB12CD34E');
    expect(normaliseSearchTerm('9AB12CD34').trxId).toBeNull();
  });

  it('phone: every accepted spelling becomes E.164', () => {
    for (const raw of ['01712345678', '1712345678', '+8801712345678', '+880 1712 345678']) {
      expect(normaliseSearchTerm(raw).phone).toBe('+8801712345678');
    }
    expect(normaliseSearchTerm('01999').phone).toBeNull();
  });

  it('email is always a lower-cased substring; an empty term matches nothing', () => {
    expect(normaliseSearchTerm('Nusrat.Jahan@GMAIL.com').email).toBe('nusrat.jahan@gmail.com');
    expect(normaliseSearchTerm('  ').email).toBeNull();
  });

  it('a term can be several things at once — all interpretations are kept', () => {
    // Ten alphanumerics: a trxID, a reference candidate (rejected: wrong
    // length) and an email substring.
    const t = normaliseSearchTerm('9AB12CD34E');
    expect(t.trxId).toBe('9AB12CD34E');
    expect(t.reference).toBeNull();
    expect(t.email).toBe('9ab12cd34e');
  });
});

describe('ordersService.searchOrders', () => {
  async function setup() {
    const db = fakeDb({ events: [event()], ticketTypes: [ticketType({ quantityTotal: 500 })] });
    const orders = createOrdersService({
      orders: db.orders,
      tickets: db.tickets,
      events: db.events,
      ticketTypes: db.ticketTypes,
      inventory: createInventoryService(db.inventoryRepo),
      runInTransaction: db.runInTransaction,
      now: () => NOW,
    });
    const mk = (email: string, phone: string) =>
      orders.createOrder({
        eventSlug: 'live-dhaka',
        ticketTypeId: 'tt-1',
        quantity: 1,
        buyerName: 'Nusrat Jahan',
        buyerEmail: email,
        buyerPhone: phone,
        attendeeNames: ['Nusrat Jahan'],
      });
    return { orders, mk };
  }

  it('finds by reference, trxID, phone and email and says which field matched', async () => {
    const { orders, mk } = await setup();
    const a = await mk('nusrat@example.com', '+8801712345678');
    const b = await mk('tanvir@example.com', '+8801912345678');
    await orders.submitPayment(b.id, { trxId: '9AB12CD34E', senderMsisdn: '+8801912345678' });

    const byRef = await orders.searchOrders(
      ordersSearchSchema.parse({ q: a.reference.toLowerCase() }),
    );
    expect(byRef.rows.map((r) => r.order.id)).toEqual([a.id]);
    expect(byRef.rows[0]?.matchedField).toBe('reference');

    const byTrx = await orders.searchOrders(ordersSearchSchema.parse({ q: '9ab12cd34e' }));
    expect(byTrx.rows.map((r) => r.order.id)).toEqual([b.id]);
    expect(byTrx.rows[0]?.matchedField).toBe('trxId');

    const byPhone = await orders.searchOrders(ordersSearchSchema.parse({ q: '01712345678' }));
    expect(byPhone.rows.map((r) => r.order.id)).toEqual([a.id]);
    expect(byPhone.rows[0]?.matchedField).toBe('phone');

    const byEmail = await orders.searchOrders(ordersSearchSchema.parse({ q: 'TANVIR' }));
    expect(byEmail.rows.map((r) => r.order.id)).toEqual([b.id]);
    expect(byEmail.rows[0]?.matchedField).toBe('email');

    const none = await orders.searchOrders(ordersSearchSchema.parse({ q: '01999888777' }));
    expect(none.rows).toEqual([]);
    expect(none.total).toBe(0);
  });

  it('filters by status and lists newest first; no term means no matchedField', async () => {
    const { orders, mk } = await setup();
    const a = await mk('a@example.com', '+8801712345678');
    const b = await mk('b@example.com', '+8801812345678');
    await orders.submitPayment(b.id, { trxId: 'TRX0000001', senderMsisdn: '+8801812345678' });

    const all = await orders.searchOrders(ordersSearchSchema.parse({}));
    expect(all.rows.map((r) => r.order.id)).toEqual([b.id, a.id]);
    expect(all.rows.every((r) => r.matchedField === null)).toBe(true);
    expect(all.total).toBe(2);

    const checking = await orders.searchOrders(
      ordersSearchSchema.parse({ status: 'pending_verification' }),
    );
    expect(checking.rows.map((r) => r.order.id)).toEqual([b.id]);
  });

  it('paginates with a total and clamps an out-of-range page to the last one', async () => {
    const { orders, mk } = await setup();
    for (let i = 0; i < ORDERS_PAGE_SIZE + 3; i++) {
      await mk(`buyer${i}@example.com`, `+88017123${String(i).padStart(5, '0')}`);
    }
    const p1 = await orders.searchOrders(ordersSearchSchema.parse({}));
    expect(p1.rows).toHaveLength(ORDERS_PAGE_SIZE);
    expect(p1.total).toBe(ORDERS_PAGE_SIZE + 3);
    expect(p1.pages).toBe(2);

    const p2 = await orders.searchOrders(ordersSearchSchema.parse({ page: '2' }));
    expect(p2.rows).toHaveLength(3);
    expect(p2.page).toBe(2);

    const p9 = await orders.searchOrders(ordersSearchSchema.parse({ page: '9' }));
    expect(p9.page).toBe(2);
    expect(p9.rows).toHaveLength(3);
  });

  it('date range is Dhaka calendar days, "to" inclusive', async () => {
    const { orders, mk } = await setup();
    // NOW is 2026-09-20T10:00Z = 16:00 Dhaka on the 20th; fake orders are stamped NOW + n ms.
    const o = await mk('d@example.com', '+8801712345678');
    const hit = await orders.searchOrders(
      ordersSearchSchema.parse({ from: '2026-09-20', to: '2026-09-20' }),
    );
    expect(hit.rows.map((r) => r.order.id)).toEqual([o.id]);
    const before = await orders.searchOrders(ordersSearchSchema.parse({ to: '2026-09-19' }));
    expect(before.rows).toEqual([]);
    const after = await orders.searchOrders(ordersSearchSchema.parse({ from: '2026-09-21' }));
    expect(after.rows).toEqual([]);
  });
});

describe('matchedField', () => {
  it('prefers the most specific interpretation in order reference → trxID → phone → email', () => {
    const row = {
      order: {
        reference: 'EA-7K3M9Q',
        bkashTrxId: '9AB12CD34E',
        buyerPhone: '+8801712345678',
        buyerEmail: 'nusrat@example.com',
      },
      eventTitle: '',
      ticketTypeName: '',
    } as Parameters<typeof matchedField>[0];
    expect(matchedField(row, normaliseSearchTerm('EA-7K3M9Q'))).toBe('reference');
    expect(matchedField(row, normaliseSearchTerm('9AB12CD34E'))).toBe('trxId');
    expect(matchedField(row, normaliseSearchTerm('01712345678'))).toBe('phone');
    expect(matchedField(row, normaliseSearchTerm('nusrat'))).toBe('email');
    expect(matchedField(row, normaliseSearchTerm('nobody'))).toBeNull();
    expect(matchedField(row, null)).toBeNull();
  });
});

describe('csv', () => {
  it('quotes only what needs quoting, doubles quotes, neutralises formulas', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField(' padded')).toBe('" padded"');
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvField(null)).toBe('');
    expect(csvField(3)).toBe('3');
  });

  it('starts with a BOM, ends lines with CRLF', () => {
    const out = toCsv(['a', 'b'], [['1', 'x,y']]);
    expect(out).toBe('﻿a,b\r\n1,"x,y"\r\n');
  });

  it('formats paisa as a plain decimal for spreadsheets', () => {
    expect(formatDecimalBDT(123456)).toBe('1234.56');
    expect(formatDecimalBDT(500)).toBe('5.00');
    expect(formatDecimalBDT(0)).toBe('0.00');
  });
});
