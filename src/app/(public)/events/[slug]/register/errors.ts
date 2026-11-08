import {
  EventNotFoundError,
  InvalidQuantityError,
  PromoCodeNotValidError,
  RegistrationClosedError,
  SoldOutError,
  TicketTypeNotFoundError,
  TicketTypeNotOnSaleError,
  TooManyOpenOrdersError,
} from '@/server/lib/errors';
import { HOLD_MINUTES } from '@/server/lib/hold';
import { MAX_TICKETS_PER_ORDER, MIN_TICKETS_PER_ORDER } from '@/server/lib/order-rules';
import type { FormError } from '@/lib/form-error-text';
import type { Messages } from '@/messages/en';

/**
 * L3: what a refused order says, as codes the page words in the visitor's
 * language (`register.banner.<code>` in the catalogue). Pure, so every
 * branch is unit-tested without a request.
 */

export type RegisterBannerCode = keyof Messages['register']['banner'];

export interface RegisterBanner {
  code: RegisterBannerCode;
  values?: Record<string, number>;
  /** The ticket type the refused single ticket was for: the form disables it. */
  soldOutTicketTypeId?: string;
}

/** A code that stopped applying is the buyer's field, not a banner (design A3). */
export function promoFieldError(reason: PromoCodeNotValidError['reason']): FormError {
  return { code: reason === 'unknown' ? 'promoInvalid' : 'promoNotForType' };
}

/** `unexpected` means an outage: the caller logs it, and never blames the buyer. */
export function registerBanner(err: unknown): RegisterBanner {
  if (err instanceof SoldOutError) {
    // Only a refused single ticket proves none are left. A larger order may
    // just be more than remains — usual when the event hides its counts
    // (ADR-055) — so the type stays choosable for a smaller quantity.
    return err.requested > 1
      ? { code: 'soldOutMany' }
      : { code: 'soldOutOne', soldOutTicketTypeId: err.ticketTypeId };
  }
  if (err instanceof RegistrationClosedError || err instanceof EventNotFoundError) {
    return { code: 'closed' };
  }
  if (err instanceof TicketTypeNotOnSaleError || err instanceof TicketTypeNotFoundError) {
    return { code: 'notOnSale' };
  }
  if (err instanceof TooManyOpenOrdersError) {
    return { code: 'tooManyOpen', values: { limit: err.limit, minutes: HOLD_MINUTES } };
  }
  if (err instanceof InvalidQuantityError) {
    // From the order rules, so the sentence can't drift from the limit.
    return { code: 'quantity', values: { min: MIN_TICKETS_PER_ORDER, max: MAX_TICKETS_PER_ORDER } };
  }
  return { code: 'unexpected' };
}
