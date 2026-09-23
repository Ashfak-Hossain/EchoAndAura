/**
 * Dev seed: `pnpm db:seed [--reset]`. Builds five believable Dhaka events
 * and ~150 orders in every state THROUGH THE REAL SERVICES, so counters,
 * audit rows, CHECKs and invariants hold by construction. A movable clock is
 * each service's `now`; email hooks are no-ops (nothing is queued or sent).
 * The one seed-only step is backdating created_at columns afterwards, so
 * the reports read as weeks of history rather than one spike today.
 *
 * Refuses anything but a local dev database (guard.ts). `--reset` empties
 * events, orders, tickets and promo codes first; users and settings stay.
 */
import { addHours, addSeconds } from 'date-fns';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, queryClient } from '@/db/client';
import { events, orderEvents, orders, promoCodes, tickets } from '@/db/schema';
import { eventsRepository } from '@/server/repositories/events.repository';
import { inventoryRepository } from '@/server/repositories/inventory.repository';
import { ordersRepository } from '@/server/repositories/orders.repository';
import { promoCodesRepository } from '@/server/repositories/promo-codes.repository';
import { settingsRepository } from '@/server/repositories/settings.repository';
import { ticketTypesRepository } from '@/server/repositories/ticket-types.repository';
import { ticketsRepository } from '@/server/repositories/tickets.repository';
import { createEventsService } from '@/server/services/events.service';
import { createFulfilmentService } from '@/server/services/fulfilment.service';
import { createInventoryService } from '@/server/services/inventory.service';
import { createOrdersService } from '@/server/services/orders.service';
import { createPromoCodesService } from '@/server/services/promo-codes.service';
import { createTicketTypesService } from '@/server/services/ticket-types.service';
import { createS3ObjectStorage, readStorageEnv } from '@/server/storage/object-storage';
import { isRejectionReason } from '@/server/lib/rejection-reasons';
import { siteUrl } from '@/lib/env.public';
import { renderCover } from './covers';
import { SeedTargetError, assertSeedTarget } from './guard';
import { buildSeedPlan, type SeedOrder } from './plan';

const ACTOR = process.env.SEED_ACTOR ?? 'admin@example.com';
const reset = process.argv.includes('--reset');

async function main(): Promise<void> {
  const target = assertSeedTarget(process.env, process.env.DATABASE_URL);
  const realNow = new Date();
  const plan = buildSeedPlan(realNow);

  // Every service reads this clock: set it to "when" before each step.
  let clock = realNow;
  const now = () => clock;
  const noop = async () => {};
  const runInTransaction = <T>(fn: Parameters<typeof db.transaction<T>>[0]) => db.transaction(fn);

  const storage = createS3ObjectStorage(readStorageEnv());
  const eventsService = createEventsService(eventsRepository, ticketTypesRepository, storage, {
    now,
  });
  const ticketTypesService = createTicketTypesService(ticketTypesRepository);
  const inventory = createInventoryService(inventoryRepository);
  const ordersService = createOrdersService({
    orders: ordersRepository,
    tickets: ticketsRepository,
    events: eventsRepository,
    ticketTypes: ticketTypesRepository,
    inventory,
    promoCodes: promoCodesRepository,
    runInTransaction,
    now,
    onOrderCreated: noop,
    onOrderExpired: noop,
  });
  const fulfilment = createFulfilmentService({
    orders: ordersRepository,
    tickets: ticketsRepository,
    ticketTypes: ticketTypesRepository,
    inventory,
    runInTransaction,
    onTicketsIssued: noop,
    onOrderRejected: noop,
  });
  const promoService = createPromoCodesService({
    promoCodes: promoCodesRepository,
    events: eventsRepository,
    ticketTypes: ticketTypesRepository,
    runInTransaction,
    now,
  });

  console.log(`Seeding ${target.database} on ${target.host}${reset ? ' (reset)' : ''}…`);

  if (reset) {
    const keys = (await db.select({ key: events.imageKey }).from(events))
      .map((r) => r.key)
      .filter((k): k is string => k !== null);
    await db.execute(
      sql`TRUNCATE order_events, tickets, orders, promo_code_ticket_types, promo_codes, ticket_types, events`,
    );
    // After the rows are gone; an orphaned object is harmless, a dangling key is not.
    let removed = 0;
    for (const key of keys) {
      try {
        await storage.delete(key);
        removed++;
      } catch {
        // best-effort
      }
    }
    console.log(
      `  reset: emptied events, orders, tickets, promo codes; ${removed} cover objects removed`,
    );
  }

  // --- Settings: only when none are saved ------------------------------------
  if (!(await settingsRepository.get())) {
    await settingsRepository.upsert(
      {
        bkashReceiveNumber: '01712 345678',
        bkashAccountName: 'Rajibul Karim',
        bkashAccountType: 'personal',
        supportEmail: 'hello@echoandaura.com',
        supportPhone: '01712 345678',
        facebookPageUrl: null,
        verificationPromise: 'usually within 4 hours',
        organizerName: 'Echo & Aura',
        organizerAddress: 'House 42, Road 11, Banani, Dhaka 1213',
      },
      'seed',
    );
    console.log('  settings: demo organizer details saved (edit them at /admin/settings)');
  }

  // --- Events, ticket types, covers, publish ---------------------------------
  const eventIds = new Map<string, string>();
  const typeIds = new Map<string, string>(); // `${eventKey}:${typeKey}` → id
  const skipped = new Set<string>();
  for (const e of plan.events) {
    const existing = await eventsRepository.findBySlug(e.slug);
    if (existing) {
      skipped.add(e.key);
      eventIds.set(e.key, existing.id);
      for (const t of await ticketTypesRepository.listByEvent(existing.id)) {
        const seedType = e.ticketTypes.find((s) => s.name === t.name);
        if (seedType) typeIds.set(`${e.key}:${seedType.key}`, t.id);
      }
      console.log(`  ${e.title}: already seeded — skipped`);
      continue;
    }
    clock = e.createdAt;
    const created = await eventsService.createEvent({
      title: e.title,
      slug: e.slug,
      description: e.description,
      venue: e.venue,
      venueHidden: e.venueHidden,
      venueArea: e.venueArea,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      registrationOpensAt: e.registrationOpensAt,
      registrationClosesAt: e.registrationClosesAt,
    });
    eventIds.set(e.key, created.id);
    for (const t of e.ticketTypes) {
      const row = await ticketTypesService.createTicketType(created.id, {
        name: t.name,
        pricePaisa: t.pricePaisa,
        quantityTotal: t.quantityTotal,
        salesStartsAt: t.salesStartsAt,
        salesEndsAt: t.salesEndsAt,
      });
      typeIds.set(`${e.key}:${t.key}`, row.id);
    }
    const bytes = await renderCover(e);
    const upload = await eventsService.createCoverUpload(created.id, {
      contentType: 'image/webp',
      size: bytes.length,
    });
    const put = await fetch(upload.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/webp' },
      body: new Uint8Array(bytes),
    });
    if (!put.ok) throw new Error(`cover upload for ${e.slug} failed: HTTP ${put.status}`);
    await eventsService.setCoverImage(created.id, upload.key);
    await eventsService.changeEventStatus(created.id, 'published');
    await db
      .update(events)
      .set({ createdAt: e.createdAt, updatedAt: e.createdAt })
      .where(eq(events.id, created.id));
    console.log(`  ${e.title}: published`);
  }

  // --- Promo codes -----------------------------------------------------------
  clock = plan.promosAt;
  for (const p of plan.promos) {
    if (await promoCodesRepository.findByCode(p.code)) continue;
    const ids = p.restrictTo.map((r) => typeIds.get(`${r.eventKey}:${r.typeKey}`));
    if (ids.some((id) => !id)) continue;
    const row = await promoService.create(
      {
        code: p.code,
        type: p.type,
        value: p.value,
        active: p.active,
        ticketTypeIds: ids as string[],
      },
      ACTOR,
    );
    await db
      .update(promoCodes)
      .set({ createdAt: plan.promosAt, updatedAt: plan.promosAt })
      .where(eq(promoCodes.id, row.id));
  }

  // --- Orders, in the order they happened ------------------------------------
  const done: { id: string; seed: SeedOrder }[] = [];
  const todo = plan.orders.filter((o) => !skipped.has(o.eventKey));
  for (const [i, o] of todo.entries()) {
    const event = plan.events.find((e) => e.key === o.eventKey)!;
    const ticketTypeId = typeIds.get(`${o.eventKey}:${o.typeKey}`)!;
    try {
      clock = o.createdAt;
      if (o.story === 'comp') {
        const { order } = await fulfilment.issueComplimentaryTickets({
          eventId: eventIds.get(o.eventKey)!,
          ticketTypeId,
          quantity: o.quantity,
          guestName: o.buyer.name,
          guestEmail: o.buyer.email,
          reason: o.reason ?? 'Guest list',
          actor: ACTOR,
        });
        done.push({ id: order.id, seed: o });
        continue;
      }
      const order = await ordersService.createOrder({
        eventSlug: event.slug,
        ticketTypeId,
        quantity: o.quantity,
        buyerName: o.buyer.name,
        buyerEmail: o.buyer.email,
        buyerPhone: o.phone,
        attendeeNames: Array.from({ length: o.quantity }, () => o.buyer.name),
        promoCode: o.promoCode,
      });
      done.push({ id: order.id, seed: o });
      if (o.submittedAt && o.trxId) {
        clock = o.submittedAt;
        await ordersService.submitPayment(order.id, { trxId: o.trxId, senderMsisdn: o.phone });
      }
      if ((o.story === 'issued' || o.story === 'cancel_one') && o.decidedAt) {
        clock = o.decidedAt;
        const { tickets: issued } = await fulfilment.approveOrder(order.id, {
          actor: ACTOR,
          verifiedTrxId: o.trxId!,
        });
        if (o.story === 'cancel_one' && o.cancelledAt) {
          clock = o.cancelledAt;
          await fulfilment.cancelTicket(issued[0]!.id, {
            orderId: order.id,
            actor: ACTOR,
            reason: 'Buyer can’t make it — refunded by bKash',
          });
        }
      }
      if (o.story === 'rejected' && o.decidedAt && o.reason && isRejectionReason(o.reason)) {
        clock = o.decidedAt;
        await fulfilment.rejectOrder(order.id, { actor: ACTOR, reason: o.reason });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      throw new Error(
        `order ${i + 1}/${todo.length} (${o.eventKey}/${o.typeKey}, ${o.story}, ${o.buyer.name}) failed — ${msg}`,
      );
    }
  }

  // Holds that lapsed long ago go the way the worker sends them.
  clock = realNow;
  const expiry = await ordersService.expireLapsedHolds(realNow);

  // Spring Fever happened: archive it now that its orders exist.
  for (const e of plan.events) {
    if (!e.archiveAt || skipped.has(e.key)) continue;
    clock = e.archiveAt;
    await eventsService.changeEventStatus(eventIds.get(e.key)!, 'archived');
    await db
      .update(events)
      .set({ updatedAt: e.archiveAt })
      .where(eq(events.id, eventIds.get(e.key)!));
  }

  // --- Backdating (seed-only) ------------------------------------------------
  // The database stamps real time; the audit trail keeps its sequence and
  // actors, and gets the moments the plan says they happened.
  for (const { id, seed } of done) {
    const d = seed.decidedAt;
    const stamps: Record<string, Date | undefined> = {
      'order.created': seed.createdAt,
      'order.comp_issued': seed.createdAt,
      'payment.submitted': seed.submittedAt,
      'payment.approved': d,
      'tickets.issued': d ? addSeconds(d, 1) : undefined,
      'payment.rejected': d,
      'ticket.cancelled': seed.cancelledAt,
      'order.cancelled': seed.cancelledAt ? addSeconds(seed.cancelledAt, 1) : undefined,
      'order.expired': seed.story === 'expired' ? addHours(seed.createdAt, 24) : undefined,
    };
    for (const [action, at] of Object.entries(stamps)) {
      if (!at) continue;
      await db
        .update(orderEvents)
        .set({ createdAt: at })
        .where(and(eq(orderEvents.orderId, id), eq(orderEvents.action, action)));
    }
    const last =
      seed.cancelledAt ?? stamps['order.expired'] ?? d ?? seed.submittedAt ?? seed.createdAt;
    await db
      .update(orders)
      .set({ createdAt: seed.createdAt, updatedAt: last })
      .where(eq(orders.id, id));
    if (d) {
      await db
        .update(tickets)
        .set({ createdAt: d, updatedAt: d })
        .where(and(eq(tickets.orderId, id), eq(tickets.status, 'issued')));
      if (seed.cancelledAt) {
        await db
          .update(tickets)
          .set({ createdAt: d, updatedAt: seed.cancelledAt })
          .where(and(eq(tickets.orderId, id), eq(tickets.status, 'cancelled')));
      }
    }
  }

  // --- Summary -----------------------------------------------------------------
  const ids = done.map((x) => x.id);
  const byStatus =
    ids.length === 0
      ? []
      : await db
          .select({ status: orders.status, n: sql<number>`count(*)::int` })
          .from(orders)
          .where(inArray(orders.id, ids))
          .groupBy(orders.status);
  const base = (() => {
    try {
      return siteUrl();
    } catch {
      return 'http://localhost:3000';
    }
  })();
  console.log('');
  console.log(`Seeded ${done.length} orders (${expiry.expired} expired by the hold rule):`);
  for (const s of byStatus) console.log(`  ${s.status.padEnd(22)} ${s.n}`);
  console.log('');
  for (const e of plan.events) console.log(`  ${e.title.padEnd(40)} ${base}/events/${e.slug}`);
  console.log('');
  console.log('  Promo codes: DHAKA15 (15%), VIP500 (৳500 off VIP), EARLYFRIENDS (off)');
  console.log(`  Admin actions are recorded as ${ACTOR}. No admin yet? pnpm admin:create`);
}

main()
  .then(() => queryClient.end())
  .catch(async (err: unknown) => {
    console.error(err instanceof SeedTargetError ? `Seed refused: ${err.message}` : err);
    await queryClient.end();
    process.exitCode = 1;
  });
