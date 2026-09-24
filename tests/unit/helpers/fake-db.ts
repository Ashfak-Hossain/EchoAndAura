import { expect, vi } from 'vitest';
import type { DbExecutor } from '@/db/executor';
import {
  InventoryStateError,
  OrderReferenceCollisionError,
  TicketCodeCollisionError,
  TrxIdAlreadyUsedError,
} from '@/server/lib/errors';
import type { EventRecord, EventsRepository } from '@/server/repositories/events.repository';
import type { InventoryRepository } from '@/server/repositories/inventory.repository';
import type {
  NewOrder,
  NewOrderEvent,
  OrderEventRecord,
  OrderRecord,
  OrdersRepository,
} from '@/server/repositories/orders.repository';
import type {
  TicketTypeRecord,
  TicketTypesRepository,
} from '@/server/repositories/ticket-types.repository';
import type {
  NewTicket,
  TicketRecord,
  TicketsRepository,
} from '@/server/repositories/tickets.repository';

/**
 * In-memory stand-in for the database used by the order-side service tests:
 * counters, rows, and a transaction runner that snapshots state and
 * restores it when the callback throws, so tests can assert exactly what a
 * rollback leaves behind. Honours the repository contracts (conditional
 * transition, UNIQUE trxID / reference / ticket code).
 */
export function event(over: Partial<EventRecord> = {}): EventRecord {
  return {
    id: 'ev-1',
    slug: 'live-dhaka',
    title: 'Live — Dhaka',
    description: null,
    venue: null,
    venueHidden: false,
    venueArea: null,
    startsAt: new Date('2026-10-01T13:00:00Z'),
    endsAt: null,
    registrationOpensAt: new Date('2026-09-11T13:00:00Z'),
    registrationClosesAt: new Date('2026-09-26T13:00:00Z'),
    status: 'published',
    imageKey: null,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

export function ticketType(over: Partial<TicketTypeRecord> = {}): TicketTypeRecord {
  return {
    id: 'tt-1',
    eventId: 'ev-1',
    name: 'General',
    pricePaisa: 120_000,
    quantityTotal: 10,
    quantitySold: 0,
    quantityReserved: 0,
    salesStartsAt: null,
    salesEndsAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

export const NOW = new Date('2026-09-20T10:00:00Z');
export const T0 = new Date('2026-01-01T00:00:00Z');

/**
 * A fake "database": counters + rows, and a transaction runner that
 * snapshots state and restores it when the callback throws — so the test
 * can assert what a rollback leaves behind.
 */
export function fakeDb(seed: { events: EventRecord[]; ticketTypes: TicketTypeRecord[] }) {
  let state = {
    types: new Map(seed.ticketTypes.map((t) => [t.id, { ...t }])),
    orders: [] as OrderRecord[],
    events: [] as OrderEventRecord[],
    tickets: [] as TicketRecord[],
  };
  const takenRefs = new Set<string>();
  let n = 0;
  const TX = { marker: 'tx' } as unknown as DbExecutor;
  const txCalls: { started: number; committed: number; rolledBack: number } = {
    started: 0,
    committed: 0,
    rolledBack: 0,
  };

  const events: EventsRepository = {
    list: async () => seed.events,
    listByStatus: async () => seed.events,
    findById: async (id) => seed.events.find((e) => e.id === id) ?? null,
    findBySlug: async (slug) => seed.events.find((e) => e.slug === slug) ?? null,
    insert: () => Promise.reject(new Error('unused')),
    update: () => Promise.reject(new Error('unused')),
    transitionStatus: () => Promise.reject(new Error('unused')),
    setImageKey: () => Promise.reject(new Error('unused')),
  };

  const ticketTypes: TicketTypesRepository = {
    listByEvent: async (eventId) => [...state.types.values()].filter((t) => t.eventId === eventId),
    listByEvents: async (eventIds) =>
      [...state.types.values()].filter((t) => eventIds.includes(t.eventId)),
    findById: async (id) => state.types.get(id) ?? null,
    capacityByEvent: () => Promise.reject(new Error('unused')),
    insert: () => Promise.reject(new Error('unused')),
    update: () => Promise.reject(new Error('unused')),
    delete: () => Promise.reject(new Error('unused')),
  };

  const inventoryRepo: InventoryRepository = {
    reserve: vi.fn(async (id, qty, tx) => {
      expect(tx).toBe(TX); // always inside the order transaction
      const t = state.types.get(id);
      if (!t || t.quantityTotal - t.quantitySold - t.quantityReserved < qty) return false;
      t.quantityReserved += qty;
      return true;
    }),
    release: vi.fn(async (id, qty, tx) => {
      expect(tx).toBe(TX);
      const t = state.types.get(id);
      if (!t || t.quantityReserved < qty) throw new InventoryStateError(id, 'release');
      t.quantityReserved -= qty;
    }),
    convertToSold: vi.fn(async (id, qty, tx) => {
      expect(tx).toBe(TX);
      const t = state.types.get(id);
      if (!t || t.quantityReserved < qty) throw new InventoryStateError(id, 'convertToSold');
      t.quantityReserved -= qty;
      t.quantitySold += qty;
    }),
    releaseSold: vi.fn(async (id, qty, tx) => {
      expect(tx).toBe(TX);
      const t = state.types.get(id);
      if (!t || t.quantitySold < qty) throw new InventoryStateError(id, 'releaseSold');
      t.quantitySold -= qty;
    }),
  };

  const orders: OrdersRepository = {
    insert: vi.fn(async (values: NewOrder, tx) => {
      expect(tx).toBe(TX);
      if (takenRefs.has(values.reference)) throw new OrderReferenceCollisionError(values.reference);
      takenRefs.add(values.reference);
      // Distinct, increasing timestamps so "newest first" is testable.
      const stamp = new Date(NOW.getTime() + ++n);
      const row = {
        id: `order-${n}`,
        discountPaisa: 0,
        status: 'pending_payment',
        attendeeNames: [],
        bkashTrxId: null,
        bkashSenderMsisdn: null,
        promoCodeId: null,
        complimentaryReason: null,
        holdExpiresAt: null,
        createdAt: stamp,
        updatedAt: stamp,
        ...values,
      } as OrderRecord;
      state.orders.push(row);
      return row;
    }),
    insertEvent: vi.fn(async (values: NewOrderEvent, tx) => {
      // Status changes always pass their tx; the email worker audits outside one.
      if (tx !== undefined) expect(tx).toBe(TX);
      const row = {
        id: `oe-${state.events.length + 1}`,
        note: null,
        fromStatus: null,
        toStatus: null,
        createdAt: NOW,
        ...values,
      } as OrderEventRecord;
      state.events.push(row);
      return row;
    }),
    // Copies, like rows from a database: a later write never mutates what a caller already holds.
    findById: async (id) => {
      const row = state.orders.find((o) => o.id === id);
      return row ? { ...row } : null;
    },
    findByIdForUpdate: async (id, tx) => {
      expect(tx).toBe(TX);
      const row = state.orders.find((o) => o.id === id);
      return row ? { ...row } : null;
    },
    findByReference: async (ref) => {
      const row = state.orders.find((o) => o.reference === ref);
      return row ? { ...row } : null;
    },
    listEvents: async (orderId) => state.events.filter((e) => e.orderId === orderId),
    // Conditional like the real UPDATE … WHERE status = ANY(from); the
    // UNIQUE trxID index is imitated with a scan.
    transition: vi.fn(async (id, { from, to, patch = {} }, tx) => {
      expect(tx).toBe(TX);
      const row = state.orders.find((o) => o.id === id);
      if (!row || !from.includes(row.status)) return null;
      if (
        patch.bkashTrxId &&
        state.orders.some((o) => o.id !== id && o.bkashTrxId === patch.bkashTrxId)
      ) {
        throw new TrxIdAlreadyUsedError(patch.bkashTrxId);
      }
      Object.assign(row, patch, { status: to, updatedAt: NOW });
      return { ...row };
    }),
    listVerificationQueue: async () =>
      state.orders
        .filter((o) => o.status === 'pending_verification')
        .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
        .map((o) => ({
          order: { ...o },
          eventTitle: seed.events.find((e) => e.id === o.eventId)?.title ?? '',
          ticketTypeName: state.types.get(o.ticketTypeId)?.name ?? '',
        })),
    countByStatus: async (status) => state.orders.filter((o) => o.status === status).length,
    listByBuyerEmail: async (email) =>
      state.orders
        .filter((o) => o.buyerEmail === email)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((o) => ({
          order: { ...o },
          eventTitle: seed.events.find((e) => e.id === o.eventId)?.title ?? '',
          ticketTypeName: state.types.get(o.ticketTypeId)?.name ?? '',
        })),
    // Mirrors the repository's WHERE: ORed identifier equality + email
    // substring, ANDed with status / event / created range, newest first.
    totalsByStatus: async (filter) => {
      const { rows } = await orders.search(
        { ...filter, status: null },
        { limit: 100_000, offset: 0 },
      );
      const acc = new Map<string, { count: number; totalPaisa: number; compCount: number }>();
      for (const { order } of rows) {
        const t = acc.get(order.status) ?? { count: 0, totalPaisa: 0, compCount: 0 };
        acc.set(order.status, {
          count: t.count + 1,
          totalPaisa: t.totalPaisa + order.totalPaisa,
          compCount: t.compCount + (order.complimentaryReason === null ? 0 : 1),
        });
      }
      return [...acc.entries()].map(([status, t]) => ({
        status: status as OrderRecord['status'],
        ...t,
      }));
    },
    search: async (filter, page, sort = { column: 'created', desc: true }) => {
      const t = filter.term;
      const hasTerm = Boolean(t && (t.reference || t.trxId || t.phone || t.email));
      const all = state.orders
        .filter((o) => {
          if (hasTerm && t) {
            const hit =
              (t.reference && o.reference === t.reference) ||
              (t.trxId && o.bkashTrxId === t.trxId) ||
              (t.phone && o.buyerPhone === t.phone) ||
              (t.email && o.buyerEmail.includes(t.email));
            if (!hit) return false;
          }
          if (filter.status && o.status !== filter.status) return false;
          if (filter.eventId && o.eventId !== filter.eventId) return false;
          if (filter.createdFrom && o.createdAt < filter.createdFrom) return false;
          if (filter.createdBefore && o.createdAt >= filter.createdBefore) return false;
          return true;
        })
        .sort((a, b) => {
          const key = (o: typeof a): number | string =>
            sort.column === 'created'
              ? o.createdAt.getTime()
              : sort.column === 'total'
                ? o.totalPaisa
                : sort.column === 'reference'
                  ? o.reference
                  : sort.column === 'status'
                    ? o.status
                    : o.buyerName;
          const ka = key(a);
          const kb = key(b);
          const cmp = ka < kb ? -1 : ka > kb ? 1 : 0;
          return sort.desc ? -cmp : cmp;
        });
      return {
        total: all.length,
        rows: all.slice(page.offset, page.offset + page.limit).map((o) => ({
          order: { ...o },
          eventTitle: seed.events.find((e) => e.id === o.eventId)?.title ?? '',
          ticketTypeName: state.types.get(o.ticketTypeId)?.name ?? '',
        })),
      };
    },
    listLapsedHolds: async (at, limit) =>
      state.orders
        .filter((o) => o.status === 'pending_payment' && o.holdExpiresAt && o.holdExpiresAt < at)
        .slice(0, limit)
        .map((o) => ({ id: o.id, ticketTypeId: o.ticketTypeId, quantity: o.quantity })),
  };

  const tickets: TicketsRepository = {
    insertMany: vi.fn(async (rows: NewTicket[], tx) => {
      expect(tx).toBe(TX);
      const taken = new Set(state.tickets.map((t) => t.code));
      for (const r of rows) {
        if (taken.has(r.code)) throw new TicketCodeCollisionError(r.code);
        taken.add(r.code);
      }
      const created = rows.map(
        (r, i) =>
          ({
            id: `tk-${state.tickets.length + i + 1}`,
            position: i + 1,
            status: 'issued',
            checkedInAt: null,
            checkedInBy: null,
            checkedInScanId: null,
            createdAt: NOW,
            updatedAt: NOW,
            ...r,
          }) as TicketRecord,
      );
      state.tickets.push(...created);
      return created.map((t) => ({ ...t }));
    }),
    listByOrder: async (orderId) =>
      state.tickets.filter((t) => t.orderId === orderId).sort((a, b) => a.position - b.position),
    findByCode: async (code) => {
      const row = state.tickets.find((t) => t.code === code);
      return row ? { ...row } : null;
    },
    findByIdForUpdate: async (id, tx) => {
      expect(tx).toBe(TX);
      const row = state.tickets.find((t) => t.id === id);
      return row ? { ...row } : null;
    },
    // Conditional like the real UPDATE … WHERE status = 'issued' AND not checked in.
    cancel: vi.fn(async (id, tx) => {
      expect(tx).toBe(TX);
      const row = state.tickets.find((t) => t.id === id);
      if (!row || row.status !== 'issued' || row.checkedInAt) return null;
      row.status = 'cancelled';
      row.updatedAt = NOW;
      return { ...row };
    }),
    checkIn: vi.fn(async (id, { gate, scanId }, tx) => {
      expect(tx).toBe(TX);
      const row = state.tickets.find((t) => t.id === id);
      if (!row || row.status !== 'issued' || row.checkedInAt) return null;
      Object.assign(row, { checkedInAt: NOW, checkedInBy: gate, checkedInScanId: scanId });
      return { ...row };
    }),
    undoCheckIn: vi.fn(async (id, tx, scanId) => {
      expect(tx).toBe(TX);
      const row = state.tickets.find((t) => t.id === id);
      if (!row || !row.checkedInAt || (scanId && row.checkedInScanId !== scanId)) return null;
      Object.assign(row, { checkedInAt: null, checkedInBy: null, checkedInScanId: null });
      return { ...row };
    }),
    countIssuedByOrder: async (orderId, tx) => {
      expect(tx).toBe(TX);
      return state.tickets.filter((t) => t.orderId === orderId && t.status === 'issued').length;
    },
    listForEvent: async (eventId) =>
      state.tickets
        .filter((t) => t.eventId === eventId)
        .sort(
          (a, b) => a.attendeeName.localeCompare(b.attendeeName) || a.code.localeCompare(b.code),
        )
        .map((t) => ({
          ticket: { ...t },
          orderReference: state.orders.find((o) => o.id === t.orderId)?.reference ?? '',
          ticketTypeName: state.types.get(t.ticketTypeId)?.name ?? '',
        })),
    updateAttendeeName: vi.fn(async (id, expectedName, attendeeName, tx) => {
      expect(tx).toBe(TX);
      const row = state.tickets.find((t) => t.id === id);
      if (!row || row.status !== 'issued' || row.attendeeName !== expectedName) return null;
      row.attendeeName = attendeeName;
      row.updatedAt = NOW;
      return { ...row };
    }),
  };

  const runInTransaction = async <T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> => {
    txCalls.started++;
    const snapshot = structuredClone(state);
    try {
      const out = await fn(TX);
      txCalls.committed++;
      return out;
    } catch (err) {
      state = snapshot;
      txCalls.rolledBack++;
      throw err;
    }
  };

  return {
    events,
    ticketTypes,
    orders,
    tickets,
    inventoryRepo,
    runInTransaction,
    txCalls,
    takenRefs,
    get state() {
      return state;
    },
  };
}
