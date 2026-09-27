import { asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import type { DbExecutor } from '@/db/executor';
import {
  events,
  orders,
  orderStatus,
  promoCodeTicketTypes,
  promoCodes,
  ticketTypes,
} from '@/db/schema';
import {
  PromoCodeInUseError,
  PromoCodeTakenError,
  TicketTypeNotFoundError,
} from '@/server/lib/errors';
import { holdsInventory, REVENUE_STATUSES } from '@/server/lib/order-status';
import { assertValidPaisa } from '@/server/lib/money';
import { isForeignKeyViolation, isUniqueViolation } from '@/server/lib/pg-errors';
import type { PromoRule } from '@/server/lib/promo';

/**
 * The only module that touches Drizzle for `promo_codes` and
 * `promo_code_ticket_types` (B10). A code and its restriction rows are
 * always written together, inside the transaction the service opens.
 */

export type PromoCodeRecord = typeof promoCodes.$inferSelect;

/** A code as the pricing rules need it: the row plus its restriction ids. */
export interface PromoCodeRule extends PromoRule {
  id: string;
}

export interface PromoRestriction {
  ticketTypeId: string;
  ticketTypeName: string;
  eventId: string;
  eventTitle: string;
}

/** One B10 table row. */
export interface PromoCodeListRow {
  promo: PromoCodeRecord;
  restrictions: PromoRestriction[];
  /** Orders in REVENUE_STATUSES using the code, and the discount they got. */
  verifiedUses: number;
  discountGivenPaisa: number;
  /** Orders still holding stock (awaiting payment or verification). */
  pendingUses: number;
  /** Any order at all references the code — then it can never be deleted. */
  everUsed: boolean;
}

export interface PromoCodeValues {
  code: string;
  type: PromoRule['type'];
  value: number;
  active: boolean;
}

export interface PromoCodesRepository {
  findByCode(code: string): Promise<PromoCodeRule | null>;
  findById(id: string): Promise<PromoCodeRule | null>;
  list(): Promise<PromoCodeListRow[]>;
  /** @throws PromoCodeTakenError, TicketTypeNotFoundError (a restriction id that does not exist) */
  insert(
    values: PromoCodeValues,
    ticketTypeIds: string[],
    tx: DbExecutor,
  ): Promise<PromoCodeRecord>;
  /**
   * Replaces the restriction rows. Resolves null when no row has this id.
   * The code text never changes. @throws TicketTypeNotFoundError
   */
  update(
    id: string,
    patch: Omit<PromoCodeValues, 'code'>,
    ticketTypeIds: string[],
    tx: DbExecutor,
  ): Promise<PromoCodeRecord | null>;
  setActive(id: string, active: boolean): Promise<PromoCodeRecord | null>;
  /** @throws PromoCodeInUseError when any order references it. */
  delete(id: string): Promise<boolean>;
}

// Constraint names as generated in drizzle/0000_*.sql.
const CODE_UNIQUE = 'promo_codes_code_unique';
const ORDERS_FK = 'orders_promo_code_id_promo_codes_id_fk';
const TICKET_TYPE_FK = 'promo_code_ticket_types_ticket_type_id_ticket_types_id_fk';

/** A restriction naming a ticket type that does not exist: the FK is the check. */
function rethrowUnknownTicketType(err: unknown, ticketTypeIds: string[]): never {
  if (isForeignKeyViolation(err, TICKET_TYPE_FK)) {
    throw new TicketTypeNotFoundError(ticketTypeIds.join(', '));
  }
  throw err;
}

// Statuses that still hold stock: the order may yet be verified.
const PENDING = orderStatus.enumValues.filter(holdsInventory);

async function rule(where: SQL): Promise<PromoCodeRule | null> {
  // One statement: the row and its restriction ids (empty array = unrestricted).
  const [row] = await db
    .select({
      promo: promoCodes,
      ticketTypeIds: sql<string[]>`coalesce(
        array_agg(${promoCodeTicketTypes.ticketTypeId}) filter (where ${promoCodeTicketTypes.ticketTypeId} is not null),
        '{}'
      )`,
    })
    .from(promoCodes)
    .leftJoin(promoCodeTicketTypes, eq(promoCodeTicketTypes.promoCodeId, promoCodes.id))
    .where(where)
    .groupBy(promoCodes.id)
    .limit(1);
  if (!row) return null;
  const { id, code, type, value, active } = row.promo;
  return { id, code, type, value, active, ticketTypeIds: row.ticketTypeIds };
}

/** A summed amount must still be valid paisa before it leaves the repository. */
function paisa(n: number): number {
  assertValidPaisa(n);
  return n;
}

export const promoCodesRepository: PromoCodesRepository = {
  findByCode(code) {
    return rule(eq(promoCodes.code, code));
  },

  findById(id) {
    return rule(eq(promoCodes.id, id));
  },

  async list() {
    const [codes, restrictions, usage] = await Promise.all([
      db.select().from(promoCodes).orderBy(asc(promoCodes.code)),
      db
        .select({
          promoCodeId: promoCodeTicketTypes.promoCodeId,
          ticketTypeId: ticketTypes.id,
          ticketTypeName: ticketTypes.name,
          eventId: events.id,
          eventTitle: events.title,
        })
        .from(promoCodeTicketTypes)
        .innerJoin(ticketTypes, eq(ticketTypes.id, promoCodeTicketTypes.ticketTypeId))
        .innerJoin(events, eq(events.id, ticketTypes.eventId))
        .orderBy(asc(events.startsAt), asc(ticketTypes.createdAt)),
      // One grouped pass over the orders that used any code (index on promo_code_id).
      db
        .select({
          promoCodeId: orders.promoCodeId,
          verified: sql<number>`count(*) filter (where ${inArray(orders.status, [...REVENUE_STATUSES])})::int`,
          discount: sql<string>`coalesce(sum(${orders.discountPaisa}) filter (where ${inArray(orders.status, [...REVENUE_STATUSES])}), 0)`,
          pending: sql<number>`count(*) filter (where ${inArray(orders.status, PENDING)})::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(orders)
        .where(sql`${orders.promoCodeId} is not null`)
        .groupBy(orders.promoCodeId),
    ]);
    const byCode = new Map<string, PromoRestriction[]>();
    for (const r of restrictions) {
      const list = byCode.get(r.promoCodeId) ?? [];
      list.push({
        ticketTypeId: r.ticketTypeId,
        ticketTypeName: r.ticketTypeName,
        eventId: r.eventId,
        eventTitle: r.eventTitle,
      });
      byCode.set(r.promoCodeId, list);
    }
    const uses = new Map(usage.map((u) => [u.promoCodeId, u]));
    return codes.map((promo) => {
      const u = uses.get(promo.id);
      return {
        promo,
        restrictions: byCode.get(promo.id) ?? [],
        verifiedUses: u?.verified ?? 0,
        // sum() comes back as a string (bigint-safe); totals fit a number.
        discountGivenPaisa: paisa(Number(u?.discount ?? 0)),
        pendingUses: u?.pending ?? 0,
        everUsed: (u?.total ?? 0) > 0,
      };
    });
  },

  async insert(values, ticketTypeIds, tx) {
    try {
      const [row] = await tx.insert(promoCodes).values(values).returning();
      if (!row) throw new Error('insert returned no row');
      if (ticketTypeIds.length > 0) {
        await tx
          .insert(promoCodeTicketTypes)
          .values(ticketTypeIds.map((ticketTypeId) => ({ promoCodeId: row.id, ticketTypeId })));
      }
      return row;
    } catch (err: unknown) {
      if (isUniqueViolation(err, CODE_UNIQUE)) throw new PromoCodeTakenError(values.code);
      rethrowUnknownTicketType(err, ticketTypeIds);
    }
  },

  async update(id, patch, ticketTypeIds, tx) {
    const [row] = await tx
      .update(promoCodes)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(promoCodes.id, id))
      .returning();
    if (!row) return null;
    await tx.delete(promoCodeTicketTypes).where(eq(promoCodeTicketTypes.promoCodeId, id));
    if (ticketTypeIds.length > 0) {
      try {
        await tx
          .insert(promoCodeTicketTypes)
          .values(ticketTypeIds.map((ticketTypeId) => ({ promoCodeId: id, ticketTypeId })));
      } catch (err: unknown) {
        rethrowUnknownTicketType(err, ticketTypeIds);
      }
    }
    return row;
  },

  async setActive(id, active) {
    const [row] = await db
      .update(promoCodes)
      .set({ active, updatedAt: new Date() })
      .where(eq(promoCodes.id, id))
      .returning();
    return row ?? null;
  },

  async delete(id) {
    try {
      const rows = await db
        .delete(promoCodes)
        .where(eq(promoCodes.id, id))
        .returning({ id: promoCodes.id });
      return rows.length > 0;
    } catch (err: unknown) {
      // The FK is the guarantee: an order that used the code keeps naming it.
      if (isForeignKeyViolation(err, ORDERS_FK)) throw new PromoCodeInUseError(id);
      throw err;
    }
  },
};
