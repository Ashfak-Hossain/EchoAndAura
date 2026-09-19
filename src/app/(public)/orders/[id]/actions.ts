'use server';

import { revalidatePath } from 'next/cache';
import { ordersService } from '@/server/container';
import {
  OrderNotFoundError,
  OrderStatusConflictError,
  TrxIdAlreadyUsedError,
} from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import { paymentFormSchema, paymentFormValues } from '@/lib/validation/orders';

export interface PaymentFormState {
  fieldErrors?: Record<string, string>;
  /** Uniqueness is a server answer and returns as a banner, not a field error (design A4). */
  banner?: { title: string; body: string };
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
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join('.')] ??= issue.message;
    }
    return { fieldErrors, values };
  }

  try {
    await ordersService.submitPayment(orderId, {
      trxId: parsed.data.trxId,
      senderMsisdn: parsed.data.senderPhone,
    });
  } catch (err: unknown) {
    if (err instanceof TrxIdAlreadyUsedError) {
      return {
        banner: {
          title: 'This transaction ID has already been used',
          body: 'Each bKash transaction pays for one order. Check that you copied the right one from your history — or, if you think this is our mistake, message the organizer.',
        },
        values,
      };
    }
    if (err instanceof OrderStatusConflictError) {
      // The page re-renders in its real state; the banner says why the
      // typed id was not saved rather than silently swapping frames.
      revalidatePath(`/orders/${orderId}`);
      return {
        banner: {
          title:
            err.status === 'expired'
              ? 'The hold expired before your transaction ID was saved'
              : 'This order can no longer take a transaction ID',
          body: 'Already sent the money? Do not send it again — message the organizer with your order reference and TrxID.',
        },
        values,
      };
    }
    if (err instanceof OrderNotFoundError) {
      revalidatePath(`/orders/${orderId}`);
      return { submitted: true };
    }
    logger.error({ orderId, err }, 'submit payment action: unexpected error');
    return {
      banner: {
        title: 'We could not save your transaction ID',
        body: 'Nothing was lost — please try again in a moment.',
      },
      values,
    };
  }

  revalidatePath(`/orders/${orderId}`);
  return { submitted: true };
}
