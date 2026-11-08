import {
  HoldLapsedError,
  OrderStatusConflictError,
  TrxIdAlreadyUsedError,
} from '@/server/lib/errors';
import type { Messages } from '@/messages/en';

/**
 * L3: why a transaction ID was not saved, as a code the form words in the
 * page's language (`payment.banner.<code>`). Uniqueness is a server answer
 * and returns as a banner, not a field error (design A4). Pure, so every
 * branch is unit-tested without a request.
 */
export type PaymentBannerCode = keyof Messages['payment']['banner'];

/** `unexpected` means an outage: the caller logs and reports it. */
export function paymentBanner(err: unknown): PaymentBannerCode {
  if (err instanceof TrxIdAlreadyUsedError) return 'trxIdUsed';
  if (err instanceof HoldLapsedError) return 'holdExpired';
  if (err instanceof OrderStatusConflictError) {
    return err.status === 'expired' ? 'holdExpired' : 'noLongerAccepts';
  }
  return 'unexpected';
}
