import { type SaleStateInput, ticketTypeSaleState } from '@/server/lib/ticket-type-sale-state';

/**
 * What an event is offering right now, in one pure helper shared by the
 * home page (hero, cards) and the event page (plan decision 5), so "From
 * ৳600.00 · Early Bird" and the highlighted ticket row can never disagree.
 *
 * Money stays integer paisa (Invariant 1): prices are only compared and
 * passed through, never computed.
 */

export interface OfferTicketType extends SaleStateInput {
  id: string;
  name: string;
  pricePaisa: number;
}

export interface OfferEvent {
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
}

export interface OfferSummary {
  /** Lowest price a buyer can still get (see `offerSummary`); null when the event has no types. */
  fromPricePaisa: number | null;
  fromTypeName: string | null;
  /** The from-price belongs to the current Early Bird — the hero appends its name. */
  fromIsEarlyBird: boolean;
  /** The Early Bird a buyer can still get (on sale now or later); null when there is none. */
  earlyBird: { id: string; name: string; salesEndsAt: Date } | null;
  /** Registration is open and the Early Bird is selling this minute ("Early Bird on sale"). */
  earlyBirdOnSale: boolean;
  /** Ticket row to highlight on the event page: the Early Bird while it sells, if there is a choice. */
  highlightId: string | null;
}

/**
 * Early Bird is a separate ticket type with its own window, not a price
 * rule (CLAUDE.md), so it is recognised by shape: its sales end before
 * registration closes, AND it is cheaper than the cheapest type that sells
 * right up to the close. The second condition matters — a VIP tier whose
 * sales end early is not a deal. Stock is ignored here: a sold-out Early
 * Bird is still an Early Bird, it just isn't offered any more.
 */
function earlyBirdIds<T extends OfferTicketType>(
  types: readonly T[],
  close: Date | null,
): Set<string> {
  if (!close) return new Set();
  const runsToClose = (t: T) => !t.salesEndsAt || t.salesEndsAt.getTime() >= close.getTime();
  const fullWindow = types.filter(runsToClose);
  if (fullWindow.length === 0) return new Set();
  const regularPaisa = Math.min(...fullWindow.map((t) => t.pricePaisa));
  return new Set(
    types.filter((t) => !runsToClose(t) && t.pricePaisa < regularPaisa).map((t) => t.id),
  );
}

function hasSalesEnd<T extends OfferTicketType>(t: T): t is T & { salesEndsAt: Date } {
  return t.salesEndsAt !== null;
}

function cheapest<T extends OfferTicketType>(types: readonly T[]): T | null {
  // Strict `<` keeps the first of equal prices, i.e. the caller's (admin) order.
  return types.reduce<T | null>(
    (best, t) => (!best || t.pricePaisa < best.pricePaisa ? t : best),
    null,
  );
}

export function offerSummary(
  types: readonly OfferTicketType[],
  event: OfferEvent,
  now: Date,
): OfferSummary {
  const ebIds = earlyBirdIds(types, event.registrationClosesAt);

  // "Still available" = not sold out and the type's own window hasn't ended.
  // A type that opens later still counts: before registration opens that is
  // every type, and the hero should quote the Early Bird price it will open at.
  const available = types.filter((t) => {
    const state = ticketTypeSaleState(t, now);
    return state === null || state === 'opens_later';
  });

  // With several Early Bird tiers, the one that ends first is the one to name.
  const earlyBird =
    available
      .filter((t) => ebIds.has(t.id))
      .filter(hasSalesEnd)
      .sort((a, b) => a.salesEndsAt.getTime() - b.salesEndsAt.getTime())[0] ?? null;

  const registrationOpen =
    !!event.registrationOpensAt &&
    !!event.registrationClosesAt &&
    event.registrationOpensAt.getTime() <= now.getTime() &&
    now.getTime() < event.registrationClosesAt.getTime();
  const earlyBirdOnSale =
    !!earlyBird && registrationOpen && ticketTypeSaleState(earlyBird, now) === null;

  // Nothing left to buy (sold out, or every window over): still quote a
  // price — cards show it — from every type rather than show nothing.
  const from = cheapest(available.length > 0 ? available : types);

  return {
    fromPricePaisa: from ? from.pricePaisa : null,
    fromTypeName: from ? from.name : null,
    fromIsEarlyBird: !!from && !!earlyBird && from.id === earlyBird.id,
    earlyBird: earlyBird
      ? { id: earlyBird.id, name: earlyBird.name, salesEndsAt: earlyBird.salesEndsAt }
      : null,
    earlyBirdOnSale,
    // One type needs no highlight: there is nothing to choose between.
    highlightId: earlyBird && earlyBirdOnSale && types.length > 1 ? earlyBird.id : null,
  };
}
