import { describe, expect, it, vi } from 'vitest';
import { sendMagicLink } from '@/server/auth/magic-link';
import { findOrderSchema, registrationFormSchema, signInSchema } from '@/lib/validation/orders';
import { createInventoryService } from '@/server/services/inventory.service';
import { createOrdersService } from '@/server/services/orders.service';
import { NOW, event, fakeDb, ticketType } from './helpers/fake-db';

describe('registration with one name per order', () => {
  const base = {
    ticketTypeId: '7a1f2d3c-4b5e-4f60-8a9b-0c1d2e3f4a5b',
    quantity: '3',
    buyerName: '  Nusrat Jahan ',
    buyerEmail: 'nusrat@example.com',
    buyerPhone: '01712345678',
    terms: 'on',
  };
  it('fills every ticket with the buyer name when no names are given', () => {
    const r = registrationFormSchema.parse(base);
    expect(r.attendeeNames).toEqual(['Nusrat Jahan', 'Nusrat Jahan', 'Nusrat Jahan']);
  });
  it('still accepts explicit names, one per ticket', () => {
    const r = registrationFormSchema.parse({ ...base, attendeeNames: ['A B', 'C D', 'E F'] });
    expect(r.attendeeNames).toEqual(['A B', 'C D', 'E F']);
    expect(registrationFormSchema.safeParse({ ...base, attendeeNames: ['A B'] }).success).toBe(
      false,
    );
  });
});

describe('findOrderSchema / signInSchema', () => {
  it('normalises the reference (case, missing prefix) and the phone', () => {
    expect(findOrderSchema.parse({ reference: ' 7k3m9q ', phone: '01712345678' })).toEqual({
      reference: 'EA-7K3M9Q',
      phone: '+8801712345678',
    });
    expect(findOrderSchema.parse({ reference: 'EA7K3M9Q', phone: '1712345678' }).reference).toBe(
      'EA-7K3M9Q',
    );
    expect(findOrderSchema.parse({ reference: 'ea-7K3M9Q', phone: '1712345678' }).reference).toBe(
      'EA-7K3M9Q',
    );
    expect(findOrderSchema.safeParse({ reference: 'EA-7K3M9', phone: '01712345678' }).success).toBe(
      false,
    );
    expect(findOrderSchema.safeParse({ reference: 'EA-7K3M9Q', phone: '123' }).success).toBe(false);
    expect(signInSchema.parse({ email: ' Nusrat@Example.com ' })).toEqual({
      email: 'nusrat@example.com',
    });
    expect(signInSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });
});

describe('ordersService.findByReferenceAndPhone / listForBuyer', () => {
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

  it('finds an order by reference + the registered phone only', async () => {
    const { orders, mk } = await setup();
    const o = await mk('nusrat@example.com', '+8801712345678');
    expect(
      (await orders.findByReferenceAndPhone(o.reference.toLowerCase(), '+8801712345678'))?.id,
    ).toBe(o.id);
    expect(await orders.findByReferenceAndPhone(o.reference, '+8801999999999')).toBeNull();
    expect(await orders.findByReferenceAndPhone('EA-NOPE00', '+8801712345678')).toBeNull();
  });

  it('lists a buyer’s orders by email, case-insensitively, newest first', async () => {
    const { orders, mk } = await setup();
    await mk('nusrat@example.com', '+8801712345678');
    await mk('other@example.com', '+8801712345678');
    const b = await mk('nusrat@example.com', '+8801712345678');
    const mine = await orders.listForBuyer(' NUSRAT@example.com ');
    expect(mine).toHaveLength(2);
    expect(mine[0]?.order.id).toBe(b.id);
    expect(mine[0]?.eventTitle).toBe('Live — Dhaka');
  });
});

describe('sendMagicLink', () => {
  it('queues the link for buyers and unknown emails, never for the admin', async () => {
    const enqueue = vi.fn<(to: string, url: string) => Promise<void>>(async () => {});
    const roleOf = async (email: string) =>
      email === 'raj@example.com' ? 'admin' : email === 'nusrat@example.com' ? 'buyer' : null;
    await sendMagicLink(
      { email: 'nusrat@example.com', url: 'https://x/verify?token=1' },
      { roleOf, enqueue },
    );
    await sendMagicLink(
      { email: 'new@example.com', url: 'https://x/verify?token=2' },
      { roleOf, enqueue },
    );
    await sendMagicLink(
      { email: 'raj@example.com', url: 'https://x/verify?token=3' },
      { roleOf, enqueue },
    );
    expect(enqueue.mock.calls.map((c) => c[0])).toEqual(['nusrat@example.com', 'new@example.com']);
  });
});

describe('magic link exposure (test seam)', () => {
  it('is on only for APP_ENV=test with the flag — never for any other environment', async () => {
    const { magicLinksExposed } = await import('@/server/auth/magic-link');
    const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
    expect(magicLinksExposed(env({ APP_ENV: 'test', E2E_EXPOSE_MAGIC_LINK: '1' }))).toBe(true);
    expect(magicLinksExposed(env({ APP_ENV: 'test' }))).toBe(false);
    // Positive gate: a staging box that inherited the flag, a typo'd
    // APP_ENV, or an unset one under a production build all stay closed.
    for (const APP_ENV of ['production', 'prod', 'Production', 'staging', 'local', '']) {
      expect(magicLinksExposed(env({ APP_ENV, E2E_EXPOSE_MAGIC_LINK: '1' }))).toBe(false);
    }
    expect(magicLinksExposed(env({ NODE_ENV: 'development', E2E_EXPOSE_MAGIC_LINK: '1' }))).toBe(
      false,
    );
  });
});
