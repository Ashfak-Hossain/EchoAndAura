'use server';

import { revalidatePath } from 'next/cache';
import { ordersService } from '@/server/container';
import { HoldLapsedError, OrderNotFoundError, OrderStatusConflictError } from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import { reportError } from '@/server/lib/error-tracking';
import type { FormError } from '@/lib/form-error-text';
import { fieldErrorsOf } from '@/lib/validation/form-errors';
import { paymentFormSchema, paymentFormValues } from '@/lib/validation/orders';
import { type PaymentBannerCode, paymentBanner } from './errors';

// L3: every message is a code; the form words it in the page's language.
export interface PaymentFormState {
  fieldErrors?: Record<string, FormError>;
  /** Uniqueness is a server answer and returns as a banner, not a field error (design A4). */
  banner?: { code: PaymentBannerCode };
  /** Set after a successful submit so the form can close itself. */
  submitted?: boolean;
  values?: Record<string, unknown>;
}

/** Thin: Zod parse → service → revalidate the order page. */
export async function submitPaymentAction(
  orderId: string,
  _prev: PaymentFormState,
  formData: FormData,
): Promise<PaymentFormState> {
  const values = paymentFormValues(formData);
  const parsed = paymentFormSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };

  try {
    await ordersService.submitPayment(orderId, {
      trxId: parsed.data.trxId,
      senderMsisdn: parsed.data.senderPhone,
    });
  } catch (err: unknown) {
    if (err instanceof OrderNotFoundError) {
      revalidatePath(`/orders/${orderId}`);
      return { submitted: true };
    }
    // The page re-renders in its real state; the banner says why the typed
    // id was not saved rather than silently swapping frames.
    if (err instanceof OrderStatusConflictError || err instanceof HoldLapsedError) {
      revalidatePath(`/orders/${orderId}`);
    }
    const code = paymentBanner(err);
    if (code === 'unexpected') {
      logger.error({ orderId, err }, 'submit payment action: unexpected error');
      // The service's transaction has unwound before any report is sent.
      reportError(err, 'payment.submit', { route: '/orders/[id]' });
    }
    return { banner: { code }, values };
  }

  revalidatePath(`/orders/${orderId}`);
  return { submitted: true };
}
