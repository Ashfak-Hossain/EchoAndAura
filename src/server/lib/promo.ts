import { formatBDT, multiplyPaisa, percentOfPaisa } from '@/server/lib/money';

/**
 * B10 promo rules — pure, so the server (the only authority, Invariant 5)
 * and the registration form's live preview run the same arithmetic.
 *
 * A discount is PER TICKET (the design's preview: "A General ticket becomes
 * ৳1,020.00"): a percentage takes `floor(price × pct / 100)` off each
 * ticket, a fixed amount takes `min(value, price)` off each ticket, so no
 * ticket ever goes below ৳0. The order's discount is that × quantity, and
 * `computeOrderTotals` still caps it at the subtotal.
 */

export type PromoType = 'percentage' | 'fixed';

export interface PromoRule {
  code: string;
  type: PromoType;
  /** Whole percent (1–99) for 'percentage'; paisa for 'fixed'. */
  value: number;
  active: boolean;
  /** Empty = every ticket type in every event. */
  ticketTypeIds: string[];
}

/** 3–24 capitals, digits and hyphens, e.g. DHAKA15, FRIENDS-200. */
export const PROMO_CODE_PATTERN = /^[A-Z0-9](?:[A-Z0-9-]{1,22})[A-Z0-9]$/;
export const PROMO_CODE_MIN = 3;
export const PROMO_CODE_MAX = 24;

/** Buyers type codes any way they like; stored and compared upper-cased, no spaces. */
export function normalisePromoCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

export function promoAppliesTo(
  rule: Pick<PromoRule, 'ticketTypeIds'>,
  ticketTypeId: string,
): boolean {
  return rule.ticketTypeIds.length === 0 || rule.ticketTypeIds.includes(ticketTypeId);
}

/** Discount off ONE ticket at `unitPricePaisa`. */
export function promoDiscountPerTicket(
  rule: Pick<PromoRule, 'type' | 'value'>,
  unitPricePaisa: number,
): number {
  if (rule.type === 'percentage') return percentOfPaisa(unitPricePaisa, rule.value);
  return Math.min(rule.value, unitPricePaisa);
}

/** Discount off a whole order of `quantity` tickets. */
export function promoDiscountPaisa(
  rule: Pick<PromoRule, 'type' | 'value'>,
  unitPricePaisa: number,
  quantity: number,
): number {
  return multiplyPaisa(promoDiscountPerTicket(rule, unitPricePaisa), quantity);
}

/**
 * Why a code cannot be used on a ticket type, or null when it can. ONE
 * judgement for both Apply and submit, so the two can never disagree:
 * - 'unknown': no such code, switched off, or none of this event's ticket
 *   types is covered — deliberately the same answer, so probing cannot
 *   tell a switched-off or other-event code from one that never existed;
 * - 'not_for_ticket_type': the code covers other types in this event;
 * - 'makes_ticket_free': it would take the whole price off. A ৳0 order
 *   cannot be paid by bKash and would sit held until it expired; free
 *   tickets are issued by the organizer (complimentary), not by a code.
 */
export type PromoRefusal = 'unknown' | 'not_for_ticket_type' | 'makes_ticket_free';

export function judgePromo(
  rule: PromoRule | null,
  eventTicketTypes: readonly { id: string; pricePaisa: number }[],
  ticketTypeId: string,
): PromoRefusal | null {
  if (!rule || !rule.active) return 'unknown';
  const covered = eventTicketTypes.filter((t) => promoAppliesTo(rule, t.id));
  if (covered.length === 0) return 'unknown';
  const chosen = covered.find((t) => t.id === ticketTypeId);
  if (!chosen) return 'not_for_ticket_type';
  if (promoDiscountPerTicket(rule, chosen.pricePaisa) >= chosen.pricePaisa) {
    return 'makes_ticket_free';
  }
  return null;
}

/** "15% off" / "৳200.00 off each ticket". */
export function describePromo(rule: Pick<PromoRule, 'type' | 'value'>): string {
  return rule.type === 'percentage'
    ? `${rule.value}% off`
    : `${formatBDT(rule.value)} off each ticket`;
}
