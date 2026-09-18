/**
 * Why a ticket type is not selling right now: out of stock, sales not
 * started, or the window is over. `null` = on sale. Used by the admin table
 * chips (B6), the public availability wording (A2) and the dashboard.
 */
export type TicketTypeSaleState = 'sold_out' | 'opens_later' | 'window_ended';

export interface SaleStateInput {
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
  salesStartsAt: Date | null;
  salesEndsAt: Date | null;
}

export function ticketTypeSaleState(t: SaleStateInput, now: Date): TicketTypeSaleState | null {
  if (t.quantityTotal - t.quantitySold - t.quantityReserved <= 0) return 'sold_out';
  if (t.salesStartsAt && t.salesStartsAt.getTime() > now.getTime()) return 'opens_later';
  if (t.salesEndsAt && t.salesEndsAt.getTime() <= now.getTime()) return 'window_ended';
  return null;
}
