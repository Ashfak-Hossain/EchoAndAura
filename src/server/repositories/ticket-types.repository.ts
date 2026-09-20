import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { ticketTypes } from '@/db/schema';
import {
  EventNotFoundError,
  TicketTypeCapacityTooLowError,
  TicketTypeInUseError,
} from '@/server/lib/errors';
import { isCheckViolation, isForeignKeyViolation } from '@/server/lib/pg-errors';

/**
 * The only module that touches Drizzle for `ticket_types` from the admin
 * side. It never writes `quantity_sold` or `quantity_reserved` — those
 * columns belong to the inventory service and its conditional atomic UPDATE
 * (Invariant 2). Capacity floors are enforced by the database CHECK and
 * surfaced here as typed errors, never pre-checked with a read-then-write.
 */

export type TicketTypeRecord = typeof ticketTypes.$inferSelect;

export interface NewTicketType {
  eventId: string;
  name: string;
  pricePaisa: number;
  quantityTotal: number;
  salesStartsAt: Date | null;
  salesEndsAt: Date | null;
}

export type TicketTypePatch = Partial<Omit<NewTicketType, 'eventId'>>;

/** Capacity roll-up for one event, from a single GROUP BY query. */
export interface EventCapacity {
  eventId: string;
  total: number;
  sold: number;
  held: number;
  /** Lowest ticket price in paisa; null when the event has no ticket types. */
  fromPricePaisa: number | null;
}

export interface TicketTypesRepository {
  listByEvent(eventId: string): Promise<TicketTypeRecord[]>;
  /** Every ticket type of every listed event in one query (dashboard cards). */
  listByEvents(eventIds: string[]): Promise<TicketTypeRecord[]>;
  /**
   * Sold/held/total per event in ONE query — lists and the dashboard must
   * never do a query per event (N+1 with a growing events table).
   */
  capacityByEvent(eventIds: string[]): Promise<EventCapacity[]>;
  findById(id: string): Promise<TicketTypeRecord | null>;
  /** @throws EventNotFoundError when `eventId` does not exist (FK). */
  insert(values: NewTicketType): Promise<TicketTypeRecord>;
  /**
   * Resolves null when no row has this id.
   * @throws TicketTypeCapacityTooLowError when quantity_total would drop below
   *   quantity_sold + quantity_reserved (CHECK constraint).
   */
  update(id: string, patch: TicketTypePatch): Promise<TicketTypeRecord | null>;
  /**
   * Resolves false when no row has this id.
   * @throws TicketTypeInUseError when any order or ticket references it (FK).
   */
  delete(id: string): Promise<boolean>;
}

// Constraint names as generated in drizzle/0000_*.sql.
const AVAILABILITY_CHECK = 'ticket_types_availability_nonneg';
const EVENT_FK = 'ticket_types_event_id_events_id_fk';
const ORDERS_FK = 'orders_ticket_type_id_ticket_types_id_fk';
const TICKETS_FK = 'tickets_ticket_type_id_ticket_types_id_fk';

export const ticketTypesRepository: TicketTypesRepository = {
  listByEvent(eventId) {
    return db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.eventId, eventId))
      .orderBy(asc(ticketTypes.createdAt));
  },

  listByEvents(eventIds) {
    if (eventIds.length === 0) return Promise.resolve([]);
    return db
      .select()
      .from(ticketTypes)
      .where(inArray(ticketTypes.eventId, eventIds))
      .orderBy(asc(ticketTypes.createdAt));
  },

  async findById(id) {
    const [row] = await db.select().from(ticketTypes).where(eq(ticketTypes.id, id)).limit(1);
    return row ?? null;
  },

  async capacityByEvent(eventIds) {
    if (eventIds.length === 0) return [];
    const rows = await db
      .select({
        eventId: ticketTypes.eventId,
        total: sql<number>`coalesce(sum(${ticketTypes.quantityTotal}), 0)::int`,
        sold: sql<number>`coalesce(sum(${ticketTypes.quantitySold}), 0)::int`,
        held: sql<number>`coalesce(sum(${ticketTypes.quantityReserved}), 0)::int`,
        fromPricePaisa: sql<number>`min(${ticketTypes.pricePaisa})::int`,
      })
      .from(ticketTypes)
      .where(inArray(ticketTypes.eventId, eventIds))
      .groupBy(ticketTypes.eventId);
    return rows;
  },

  async insert(values) {
    try {
      const [row] = await db.insert(ticketTypes).values(values).returning();
      if (!row) throw new Error('insert returned no row');
      return row;
    } catch (err: unknown) {
      if (isForeignKeyViolation(err, EVENT_FK)) throw new EventNotFoundError(values.eventId);
      throw err;
    }
  },

  async update(id, patch) {
    try {
      const [row] = await db
        .update(ticketTypes)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(ticketTypes.id, id))
        .returning();
      return row ?? null;
    } catch (err: unknown) {
      if (isCheckViolation(err, AVAILABILITY_CHECK)) throw new TicketTypeCapacityTooLowError(id);
      throw err;
    }
  },

  async delete(id) {
    try {
      const rows = await db
        .delete(ticketTypes)
        .where(eq(ticketTypes.id, id))
        .returning({ id: ticketTypes.id });
      return rows.length > 0;
    } catch (err: unknown) {
      if (isForeignKeyViolation(err, ORDERS_FK) || isForeignKeyViolation(err, TICKETS_FK)) {
        throw new TicketTypeInUseError(id);
      }
      throw err;
    }
  },
};
