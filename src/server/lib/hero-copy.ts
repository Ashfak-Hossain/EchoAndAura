import type { OfferSummary } from '@/server/lib/event-offer';
import type { EventPhase } from '@/server/lib/event-phase';
import { formatBDT } from '@/server/lib/money';
import { dhakaDay, formatDhakaShort } from '@/lib/time';

/**
 * The home page hero's words (Canvas 6, N7), from the same `eventPhase`
 * value as the event page. Pure, so every phase's copy is unit-tested at a
 * fixed instant. Wording is the signed-off list in the Canvas 6 plan; times
 * stay 24-hour Dhaka like the rest of the site.
 */

export const HERO_EYEBROW = 'Next show';

export const COUNTDOWN_LABELS = {
  close: 'Registration closes in',
  open: 'Tickets go on sale in',
} as const;

export interface HeroCopyInput {
  phase: EventPhase;
  event: {
    startsAt: Date;
    registrationOpensAt: Date | null;
    registrationClosesAt: Date | null;
  };
  offer: Pick<OfferSummary, 'fromPricePaisa' | 'fromTypeName' | 'fromIsEarlyBird' | 'earlyBird'>;
  /** Sum of (total − sold − reserved) across ticket types. */
  availableTotal: number;
  now: Date;
}

export interface HeroCopy {
  /** Bold lead-in that repeats the chip, e.g. "On sale." (N5: the chip is never alone). */
  phaseWord: string;
  sentence: string;
  /** What the countdown counts down to; null = no countdown (sold out, closed, past). */
  countdown: { label: string; target: Date } | null;
  /** "From ৳1,200.00", or "From ৳600.00 · Early Bird" (the type's own name). */
  priceLabel: string | null;
  /** "112 tickets left" / "1 ticket left"; only while tickets can be bought. */
  leftLabel: string | null;
  /** Show "Get tickets"; otherwise "Event details" is the only action. */
  canBuy: boolean;
}

const SOLD_OUT_SENTENCE =
  'Every ticket for this show has been sold or is held. If a hold expires, tickets come back on sale here.';

function inDhaka(date: Date): string {
  return `${formatDhakaShort(date)} (Dhaka)`;
}

/** Whole Dhaka calendar days from `from` to `to` (Sat 23:59 → Thu 19:00 is 5). */
function dhakaDaysBetween(from: Date, to: Date): number {
  const dayStart = (d: Date) => {
    const [y, m, day] = dhakaDay(d).split('-').map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((dayStart(to) - dayStart(from)) / 86_400_000);
}

function groupThousands(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fromPriceLabel(offer: HeroCopyInput['offer']): string | null {
  if (offer.fromPricePaisa === null) return null;
  const price = `From ${formatBDT(offer.fromPricePaisa)}`;
  return offer.fromIsEarlyBird && offer.fromTypeName ? `${price} · ${offer.fromTypeName}` : price;
}

export function heroCopy({ phase, event, offer, availableTotal, now }: HeroCopyInput): HeroCopy {
  const canBuy = phase === 'open' || phase === 'closing_soon';
  // Before sales open the price is still worth showing (it is what the
  // countdown is for); once nothing can be bought it is noise.
  const priceLabel = canBuy || phase === 'not_open' ? fromPriceLabel(offer) : null;
  const leftLabel =
    canBuy && availableTotal > 0
      ? `${groupThousands(availableTotal)} ${availableTotal === 1 ? 'ticket' : 'tickets'} left`
      : null;
  const common = { priceLabel, leftLabel, canBuy };
  // A target already behind us would count up from zero; drop it instead.
  const countdown = (label: string, target: Date | null) =>
    target && target.getTime() > now.getTime() ? { label, target } : null;
  const close = event.registrationClosesAt;
  const opens = event.registrationOpensAt;

  switch (phase) {
    case 'open':
      return {
        ...common,
        phaseWord: 'On sale.',
        sentence: close ? `Registration is open until ${inDhaka(close)}.` : 'Registration is open.',
        countdown: countdown(COUNTDOWN_LABELS.close, close),
      };
    case 'closing_soon': {
      // Computed, not written in: the gap is set per event (usually 5 days).
      const days = close ? dhakaDaysBetween(close, event.startsAt) : 0;
      const before = days >= 1 ? `, ${days} ${days === 1 ? 'day' : 'days'} before the show` : '';
      return {
        ...common,
        phaseWord: 'Closing soon.',
        sentence: close
          ? `Registration closes ${inDhaka(close)}${before}.`
          : 'Registration closes soon.',
        countdown: countdown(COUNTDOWN_LABELS.close, close),
      };
    }
    case 'not_open': {
      if (!opens) {
        return {
          ...common,
          phaseWord: 'Not on sale yet.',
          sentence: 'Sale dates have not been announced yet.',
          countdown: null,
        };
      }
      const eb = offer.earlyBird;
      // The first sentence already says "(Dhaka)"; the second shares it.
      const earlyBird =
        eb && eb.salesEndsAt.getTime() > opens.getTime()
          ? ` ${eb.name} runs until ${formatDhakaShort(eb.salesEndsAt)}.`
          : '';
      return {
        ...common,
        phaseWord: 'Not on sale yet.',
        sentence: `Tickets go on sale ${inDhaka(opens)}.${earlyBird}`,
        countdown: countdown(COUNTDOWN_LABELS.open, opens),
      };
    }
    case 'sold_out':
      // "or is held": sold out includes unpaid holds, which can expire.
      return { ...common, phaseWord: 'Sold out.', sentence: SOLD_OUT_SENTENCE, countdown: null };
    case 'closed':
      return {
        ...common,
        phaseWord: 'Closed.',
        sentence: `Registration for this show has closed. It starts ${inDhaka(event.startsAt)}.`,
        countdown: null,
      };
    case 'past':
      // The hero never features a past show; this keeps the function total.
      return {
        ...common,
        phaseWord: 'Past.',
        sentence: `This show was on ${inDhaka(event.startsAt)}.`,
        countdown: null,
      };
  }
}
