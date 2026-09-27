import type { DbExecutor } from '@/db/executor';
import { PromoCodeNotFoundError } from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import { normalisePromoCode, type PromoType } from '@/server/lib/promo';
import { ticketTypeSaleState } from '@/server/lib/ticket-type-sale-state';
import type { EventRecord, EventsRepository } from '@/server/repositories/events.repository';
import type {
  PromoCodeListRow,
  PromoCodeRecord,
  PromoCodeRule,
  PromoCodesRepository,
} from '@/server/repositories/promo-codes.repository';
import type { TicketTypesRepository } from '@/server/repositories/ticket-types.repository';

/**
 * B10 promo codes, the admin side. Codes are global: a code with no
 * restriction rows works on every ticket type in every event. Edits never
 * touch existing orders — an order snapshots its price and discount at
 * creation (Invariant 5), so switching a code off or changing its value
 * only affects orders placed afterwards. Changes are logged with the actor;
 * they are not order state changes, so they write no `order_events` row.
 */

export interface PromoCodeInput {
  code: string;
  type: PromoType;
  /** Whole percent for 'percentage'; paisa for 'fixed'. Validated at the boundary. */
  value: number;
  active: boolean;
  /** Empty = every ticket type. */
  ticketTypeIds: string[];
}

/** One event's ticket types for the restriction picker. */
export interface PromoPickerGroup {
  event: Pick<EventRecord, 'id' | 'title' | 'status' | 'startsAt'>;
  ticketTypes: { id: string; name: string; pricePaisa: number; saleEnded: boolean }[];
}

export interface PromoCodesServiceDeps {
  promoCodes: PromoCodesRepository;
  events: Pick<EventsRepository, 'list'>;
  ticketTypes: Pick<TicketTypesRepository, 'listByEvents'>;
  runInTransaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  now?: () => Date;
}

export function createPromoCodesService({
  promoCodes,
  events,
  ticketTypes,
  runInTransaction,
  now = () => new Date(),
}: PromoCodesServiceDeps) {
  return {
    list(): Promise<PromoCodeListRow[]> {
      return promoCodes.list();
    },

    /** @throws PromoCodeNotFoundError */
    async get(id: string): Promise<PromoCodeRule> {
      const rule = await promoCodes.findById(id);
      if (!rule) throw new PromoCodeNotFoundError(id);
      return rule;
    },

    /**
     * Ticket types a code can be restricted to, grouped by event, soonest
     * first: events that are not archived, have not started and have ticket
     * types — plus any event holding a type in `keep` (an existing code's
     * restrictions must stay visible to be un-ticked). Types whose sales
     * window is over are listed but marked.
     */
    async pickerOptions(keep: string[] = []): Promise<PromoPickerGroup[]> {
      const at = now();
      const candidates = (await events.list()).sort(
        (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
      );
      const types = await ticketTypes.listByEvents(candidates.map((e) => e.id));
      const kept = new Set(keep);
      const live = candidates.filter((e) => {
        const own = types.filter((t) => t.eventId === e.id);
        if (own.some((t) => kept.has(t.id))) return true;
        return e.status !== 'archived' && e.startsAt.getTime() > at.getTime() && own.length > 0;
      });
      return live.map((e) => ({
        event: { id: e.id, title: e.title, status: e.status, startsAt: e.startsAt },
        ticketTypes: types
          .filter((t) => t.eventId === e.id)
          .map((t) => ({
            id: t.id,
            name: t.name,
            pricePaisa: t.pricePaisa,
            saleEnded: ticketTypeSaleState(t, at) === 'window_ended',
          })),
      }));
    },

    /** @throws PromoCodeTakenError, TicketTypeNotFoundError */
    async create(input: PromoCodeInput, actor: string): Promise<PromoCodeRecord> {
      const code = normalisePromoCode(input.code);
      const row = await runInTransaction((tx) =>
        promoCodes.insert(
          { code, type: input.type, value: input.value, active: input.active },
          unique(input.ticketTypeIds),
          tx,
        ),
      );
      logger.info({ actor, code, type: input.type, value: input.value }, 'promo code created');
      return row;
    },

    /** The code text is fixed; everything else can change. @throws PromoCodeNotFoundError, TicketTypeNotFoundError */
    async update(
      id: string,
      input: Omit<PromoCodeInput, 'code'>,
      actor: string,
    ): Promise<PromoCodeRecord> {
      const row = await runInTransaction((tx) =>
        promoCodes.update(
          id,
          { type: input.type, value: input.value, active: input.active },
          unique(input.ticketTypeIds),
          tx,
        ),
      );
      if (!row) throw new PromoCodeNotFoundError(id);
      logger.info(
        { actor, code: row.code, type: row.type, value: row.value },
        'promo code updated',
      );
      return row;
    },

    /** @throws PromoCodeNotFoundError */
    async setActive(id: string, active: boolean, actor: string): Promise<PromoCodeRecord> {
      const row = await promoCodes.setActive(id, active);
      if (!row) throw new PromoCodeNotFoundError(id);
      logger.info({ actor, code: row.code, active }, 'promo code switched');
      return row;
    },

    /** Only a code no order ever used. @throws PromoCodeNotFoundError, PromoCodeInUseError */
    async remove(id: string, actor: string): Promise<void> {
      const rule = await promoCodes.findById(id);
      if (!rule) throw new PromoCodeNotFoundError(id);
      if (!(await promoCodes.delete(id))) throw new PromoCodeNotFoundError(id);
      logger.info({ actor, code: rule.code }, 'promo code deleted');
    },
  };
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

export type PromoCodesService = ReturnType<typeof createPromoCodesService>;
