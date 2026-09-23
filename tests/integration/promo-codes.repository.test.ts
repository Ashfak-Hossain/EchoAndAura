import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import {
  PromoCodeInUseError,
  PromoCodeTakenError,
  TicketTypeInUseError,
  TicketTypeNotFoundError,
} from '@/server/lib/errors';
import { isCheckViolation } from '@/server/lib/pg-errors';
import { eventsRepository } from '@/server/repositories/events.repository';
import { inventoryRepository } from '@/server/repositories/inventory.repository';
import { ordersRepository } from '@/server/repositories/orders.repository';
import { promoCodesRepository } from '@/server/repositories/promo-codes.repository';
import { ticketTypesRepository } from '@/server/repositories/ticket-types.repository';
import { ticketsRepository } from '@/server/repositories/tickets.repository';
import { createInventoryService } from '@/server/services/inventory.service';
import { createOrdersService } from '@/server/services/orders.service';

/**
 * B10 against real Postgres: codes are unique and stored normalised (the
 * CHECK refuses anything else), restrictions come back as ids, usage is
 * split verified / pending, a used code cannot be deleted, a ticket type a
 * code is restricted to cannot be deleted, and createOrder stores the
 * discount the code gives — wired exactly like the container.
 */
const NOW = new Date('2026-09-20T10:00:00Z');
const tag = randomUUID()
  .slice(0, 6)
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, 'X');

describe('promoCodesRepository (Postgres)', () => {
  const eventId = randomUUID();
  const slug = `promo-${eventId}`;
  const general = randomUUID();
  const vip = randomUUID();
  const spare = randomUUID();
  const codeIds: string[] = [];

  const orders = createOrdersService({
    orders: ordersRepository,
    tickets: ticketsRepository,
    events: eventsRepository,
    ticketTypes: ticketTypesRepository,
    inventory: createInventoryService(inventoryRepository),
    promoCodes: promoCodesRepository,
    runInTransaction: (fn) => db.transaction(fn),
    now: () => NOW,
  });

  const create = (code: string, ticketTypeIds: string[] = []) =>
    db.transaction((tx) =>
      promoCodesRepository.insert(
        { code, type: 'percentage', value: 15, active: true },
        ticketTypeIds,
        tx,
      ),
    );

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.events).values({
      id: eventId,
      slug,
      title: 'Promo Test Event',
      startsAt: new Date('2026-10-01T13:00:00Z'),
      registrationOpensAt: new Date('2026-09-11T13:00:00Z'),
      registrationClosesAt: new Date('2026-09-26T13:00:00Z'),
      status: 'published',
    });
    await db.insert(schema.ticketTypes).values([
      { id: general, eventId, name: 'General', pricePaisa: 120_000, quantityTotal: 50 },
      { id: vip, eventId, name: 'VIP', pricePaisa: 350_000, quantityTotal: 10 },
      { id: spare, eventId, name: 'Spare', pricePaisa: 50_000, quantityTotal: 10 },
    ]);
  });

  afterAll(async () => {
    await db.delete(schema.orders).where(eq(schema.orders.eventId, eventId));
    await db
      .delete(schema.promoCodeTicketTypes)
      .where(inArray(schema.promoCodeTicketTypes.ticketTypeId, [general, vip, spare]));
    if (codeIds.length > 0) {
      await db.delete(schema.promoCodes).where(inArray(schema.promoCodes.id, codeIds));
    }
    await db.delete(schema.ticketTypes).where(eq(schema.ticketTypes.eventId, eventId));
    await db.delete(schema.events).where(eq(schema.events.id, eventId));
    await queryClient.end();
  });

  it('stores a code with its restrictions and finds it by code and id', async () => {
    const row = await create(`GEN${tag}`, [general]);
    codeIds.push(row.id);
    expect(await promoCodesRepository.findByCode(`GEN${tag}`)).toMatchObject({
      id: row.id,
      type: 'percentage',
      value: 15,
      active: true,
      ticketTypeIds: [general],
    });
    const any = await create(`ANY${tag}`);
    codeIds.push(any.id);
    expect((await promoCodesRepository.findById(any.id))?.ticketTypeIds).toEqual([]);
    expect(await promoCodesRepository.findByCode(`NONE${tag}`)).toBeNull();
  });

  it('refuses a duplicate code and a code that is not normalised', async () => {
    await expect(create(`GEN${tag}`)).rejects.toBeInstanceOf(PromoCodeTakenError);
    const err = await db
      .insert(schema.promoCodes)
      .values({ code: `lower${tag}`, type: 'percentage', value: 5 })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(isCheckViolation(err, 'promo_codes_code_format')).toBe(true);
    // 100% would make ৳0 orders bKash cannot pay: the database refuses it too.
    const hundred = await db
      .insert(schema.promoCodes)
      .values({ code: `FREE${tag}`, type: 'percentage', value: 100 })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(isCheckViolation(hundred, 'promo_codes_percentage_range')).toBe(true);
  });

  it('an order row whose money does not add up is refused, whoever wrote it', async () => {
    const err = await db
      .insert(schema.orders)
      .values({
        reference: `EA-X${tag.slice(0, 5)}`,
        eventId,
        ticketTypeId: general,
        quantity: 2,
        unitPricePaisa: 120_000,
        subtotalPaisa: 240_000,
        discountPaisa: 36_000,
        totalPaisa: 240_000, // should be 204,000
        buyerName: 'Wrong Sum',
        buyerEmail: 'w@example.com',
        buyerPhone: '+8801712345678',
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(isCheckViolation(err, 'orders_totals_consistent')).toBe(true);
  });

  it('an unknown restriction id rolls the whole code back', async () => {
    await expect(create(`BAD${tag}`, [randomUUID()])).rejects.toBeInstanceOf(
      TicketTypeNotFoundError,
    );
    expect(await promoCodesRepository.findByCode(`BAD${tag}`)).toBeNull();
  });

  it('update replaces the restriction rows; the code text stays', async () => {
    const row = await promoCodesRepository.findByCode(`GEN${tag}`);
    await db.transaction((tx) =>
      promoCodesRepository.update(
        row!.id,
        { type: 'fixed', value: 20_000, active: true },
        [vip, spare],
        tx,
      ),
    );
    const after = await promoCodesRepository.findById(row!.id);
    expect(after).toMatchObject({ code: `GEN${tag}`, type: 'fixed', value: 20_000 });
    expect([...after!.ticketTypeIds].sort()).toEqual([vip, spare].sort());
    // Back to 15% on General for the tests below.
    await db.transaction((tx) =>
      promoCodesRepository.update(
        row!.id,
        { type: 'percentage', value: 15, active: true },
        [general],
        tx,
      ),
    );
  });

  it('createOrder stores the discount and the code; usage splits verified / pending', async () => {
    const base = {
      eventSlug: slug,
      ticketTypeId: general,
      quantity: 2,
      buyerName: 'Nusrat Jahan',
      buyerEmail: 'n@example.com',
      buyerPhone: '+8801712345678',
      attendeeNames: ['Nusrat Jahan', 'Nusrat Jahan'],
    };
    const a = await orders.createOrder({ ...base, promoCode: `gen${tag.toLowerCase()}` });
    expect(a).toMatchObject({ subtotalPaisa: 240_000, discountPaisa: 36_000, totalPaisa: 204_000 });
    const b = await orders.createOrder({ ...base, promoCode: `GEN${tag}` });
    const c = await orders.createOrder({ ...base, promoCode: `GEN${tag}` });
    // One verified, one still pending, one expired (counts nowhere but "ever used").
    await db.update(schema.orders).set({ status: 'issued' }).where(eq(schema.orders.id, a.id));
    await db.update(schema.orders).set({ status: 'expired' }).where(eq(schema.orders.id, c.id));

    const list = await promoCodesRepository.list();
    const row = list.find((r) => r.promo.code === `GEN${tag}`);
    expect(row).toMatchObject({
      verifiedUses: 1,
      pendingUses: 1,
      discountGivenPaisa: 36_000,
      everUsed: true,
      restrictions: [
        {
          ticketTypeId: general,
          ticketTypeName: 'General',
          eventId,
          eventTitle: 'Promo Test Event',
        },
      ],
    });
    expect(list.find((r) => r.promo.code === `ANY${tag}`)).toMatchObject({
      verifiedUses: 0,
      pendingUses: 0,
      discountGivenPaisa: 0,
      everUsed: false,
    });
    expect(b.promoCodeId).toBe(row!.promo.id);
  });

  it('a used code cannot be deleted; an unused one can', async () => {
    const used = await promoCodesRepository.findByCode(`GEN${tag}`);
    await expect(promoCodesRepository.delete(used!.id)).rejects.toBeInstanceOf(PromoCodeInUseError);
    const unused = await promoCodesRepository.findByCode(`ANY${tag}`);
    expect(await promoCodesRepository.delete(unused!.id)).toBe(true);
    expect(await promoCodesRepository.findById(unused!.id)).toBeNull();
  });

  it('switching off is a single write', async () => {
    const row = await promoCodesRepository.findByCode(`GEN${tag}`);
    expect((await promoCodesRepository.setActive(row!.id, false))?.active).toBe(false);
    expect((await promoCodesRepository.findById(row!.id))?.active).toBe(false);
    expect(await promoCodesRepository.setActive(randomUUID(), true)).toBeNull();
  });

  it('a ticket type a code is restricted to cannot be deleted (no silent widening)', async () => {
    const row = await create(`SPARE${tag}`, [spare]);
    codeIds.push(row.id);
    const err = await ticketTypesRepository.delete(spare).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TicketTypeInUseError);
    expect((err as TicketTypeInUseError).by).toBe('promo_code');
    expect((await promoCodesRepository.findById(row.id))?.ticketTypeIds).toEqual([spare]);
  });
});
