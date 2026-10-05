import { createTranslator } from 'use-intl/core';
import { catalogue } from '@/i18n/catalogue';
import type { Locale } from '@/i18n/locales';
import type { EventPhase } from '@/server/lib/event-phase';
import type { ChipTone } from '@/lib/status-labels';
import { formatDhakaDayMonth } from '@/lib/time';

/**
 * One chip vocabulary for an event's sale phase (Canvas 6, N5), sitewide:
 * the home hero, event cards and the event page. Pure so the words are
 * tested once; the `Chip` component only draws them.
 *
 * `variant` only changes "not on sale yet": a card has room for nothing
 * else, so it carries the date ("On sale 25 Oct") to tell a buyer when to
 * come back; the hero says it in its sentence and countdown instead.
 */

export interface PhaseChipLabel {
  tone: ChipTone;
  label: string;
  /** Live states (selling, closing) carry the dot. */
  dot: boolean;
}

export interface PhaseChipOptions {
  registrationOpensAt: Date | null;
  /** From `offerSummary`: registration is open and the Early Bird is selling now. */
  earlyBirdOnSale: boolean;
  variant: 'hero' | 'card';
  /** ADR-061: the page's language (English by default). */
  locale?: Locale;
}

export function phaseChipLabel(
  phase: EventPhase,
  { registrationOpensAt, earlyBirdOnSale, variant, locale = 'en' }: PhaseChipOptions,
): PhaseChipLabel {
  const t = createTranslator({ locale, messages: catalogue(locale), namespace: 'chips' });
  switch (phase) {
    case 'open':
      return {
        tone: 'success',
        label: earlyBirdOnSale ? t('earlyBirdOnSale') : t('onSale'),
        dot: true,
      };
    case 'closing_soon':
      return { tone: 'warning', label: t('closingSoon'), dot: true };
    case 'not_open':
      return {
        tone: 'info',
        label:
          variant === 'card' && registrationOpensAt
            ? t('onSaleFrom', { date: formatDhakaDayMonth(registrationOpensAt, locale) })
            : t('notOpen'),
        dot: false,
      };
    case 'sold_out':
      return { tone: 'neutral', label: t('soldOut'), dot: false };
    case 'closed':
      return { tone: 'neutral', label: t('closed'), dot: false };
    case 'past':
      return { tone: 'neutralStrong', label: t('past'), dot: false };
  }
}
