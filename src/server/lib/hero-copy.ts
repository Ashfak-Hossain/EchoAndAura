import { createTranslator } from 'use-intl/core';
import { catalogue } from '@/i18n/catalogue';
import type { Locale } from '@/i18n/locales';
import en from '@/messages/en';
import { groupDigits } from '@/server/lib/digits';
import type { OfferSummary } from '@/server/lib/event-offer';
import type { EventPhase } from '@/server/lib/event-phase';
import { formatBDT } from '@/server/lib/money';
import { dhakaDay, formatDhakaShort } from '@/lib/time';

/**
 * The home page hero's words (Canvas 6, N7), from the same `eventPhase`
 * value as the event page. Pure, so every phase's copy is unit-tested at a
 * fixed instant. Wording is the signed-off list in the Canvas 6 plan, in
 * the catalogue (`hero`, ADR-061); times are Dhaka's.
 */

/** English labels, for callers that only need the text (tests, defaults). */
export const HERO_EYEBROW = en.hero.eyebrow;

export const COUNTDOWN_LABELS = {
  close: en.hero.countdownClose,
  open: en.hero.countdownOpen,
} as const;

export interface HeroCopyInput {
  phase: EventPhase;
  event: {
    startsAt: Date;
    registrationOpensAt: Date | null;
    registrationClosesAt: Date | null;
    /** ADR-055: the organizer hides how many tickets are left. */
    hideAvailability?: boolean;
  };
  offer: Pick<OfferSummary, 'fromPricePaisa' | 'fromTypeName' | 'fromIsEarlyBird' | 'earlyBird'>;
  /** Sum of (total − sold − reserved) across ticket types. */
  availableTotal: number;
  now: Date;
  /** ADR-061: the page's language (English by default). */
  locale?: Locale;
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

/** Whole Dhaka calendar days from `from` to `to` (Sat 23:59 → Thu 19:00 is 5). */
function dhakaDaysBetween(from: Date, to: Date): number {
  const dayStart = (d: Date) => {
    const [y, m, day] = dhakaDay(d).split('-').map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((dayStart(to) - dayStart(from)) / 86_400_000);
}

export function heroCopy({
  phase,
  event,
  offer,
  availableTotal,
  now,
  locale = 'en',
}: HeroCopyInput): HeroCopy {
  const t = createTranslator({ locale, messages: catalogue(locale), namespace: 'hero' });
  const inDhaka = (date: Date) => t('inDhaka', { when: formatDhakaShort(date, locale) });
  const fromPriceLabel = (): string | null => {
    if (offer.fromPricePaisa === null) return null;
    const price = formatBDT(offer.fromPricePaisa, locale);
    return offer.fromIsEarlyBird && offer.fromTypeName
      ? t('fromEarlyBird', { price, name: offer.fromTypeName })
      : t('from', { price });
  };
  const canBuy = phase === 'open' || phase === 'closing_soon';
  // Before sales open the price is still worth showing (it is what the
  // countdown is for); once nothing can be bought it is noise.
  const priceLabel = canBuy || phase === 'not_open' ? fromPriceLabel() : null;
  const leftLabel =
    canBuy && availableTotal > 0 && !event.hideAvailability
      ? t('left', { count: availableTotal, n: groupDigits(availableTotal, locale) })
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
        phaseWord: t('openWord'),
        sentence: close ? t('openUntil', { when: inDhaka(close) }) : t('openNoDate'),
        countdown: countdown(t('countdownClose'), close),
      };
    case 'closing_soon': {
      // Computed, not written in: the gap is set per event (usually 5 days).
      const days = close ? dhakaDaysBetween(close, event.startsAt) : 0;
      const sentence = !close
        ? t('closesSoon')
        : days >= 1
          ? t('closesBefore', { when: inDhaka(close), days, n: groupDigits(days, locale) })
          : t('closes', { when: inDhaka(close) });
      return {
        ...common,
        phaseWord: t('closingSoonWord'),
        sentence,
        countdown: countdown(t('countdownClose'), close),
      };
    }
    case 'not_open': {
      if (!opens) {
        return {
          ...common,
          phaseWord: t('notOpenWord'),
          sentence: t('noDates'),
          countdown: null,
        };
      }
      const eb = offer.earlyBird;
      // The first sentence already says "(Dhaka)"; the second shares it.
      const goesOnSale = t('goesOnSale', { when: inDhaka(opens) });
      const earlyBird =
        eb && eb.salesEndsAt.getTime() > opens.getTime()
          ? t('earlyBird', { name: eb.name, until: formatDhakaShort(eb.salesEndsAt, locale) })
          : null;
      return {
        ...common,
        phaseWord: t('notOpenWord'),
        sentence: earlyBird ? `${goesOnSale} ${earlyBird}` : goesOnSale,
        countdown: countdown(t('countdownOpen'), opens),
      };
    }
    case 'sold_out':
      // "or is held": sold out includes unpaid holds, which can expire.
      return {
        ...common,
        phaseWord: t('soldOutWord'),
        sentence: t('soldOut'),
        countdown: null,
      };
    case 'closed':
      return {
        ...common,
        phaseWord: t('closedWord'),
        sentence: t('closed', { when: inDhaka(event.startsAt) }),
        countdown: null,
      };
    case 'past':
      // The hero never features a past show; this keeps the function total.
      return {
        ...common,
        phaseWord: t('pastWord'),
        sentence: t('past', { when: inDhaka(event.startsAt) }),
        countdown: null,
      };
  }
}
