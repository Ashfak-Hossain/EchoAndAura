'use server';

import { redirect } from 'next/navigation';
import { ordersService } from '@/server/container';
import {
  EventNotFoundError,
  InvalidQuantityError,
  RegistrationClosedError,
  SoldOutError,
  TicketTypeNotFoundError,
  TicketTypeNotOnSaleError,
} from '@/server/lib/errors';
import { registrationFormSchema, registrationFormValues } from '@/lib/validation/orders';

export interface RegistrationFormState {
  /** Field-level messages keyed by field name (attendee names as `attendeeNames.N`). */
  fieldErrors?: Record<string, string>;
  /** A banner above the form: sold out, window closed, or an outage. */
  banner?: { title: string; body: string; soldOutTicketTypeId?: string };
  /** What was submitted, so the form re-seeds instead of wiping the buyer's input. */
  values?: Record<string, unknown>;
}

/** Thin: Zod parse → service → redirect to the order page. */
export async function registerAction(
  eventSlug: string,
  _prev: RegistrationFormState,
  formData: FormData,
): Promise<RegistrationFormState> {
  const values = registrationFormValues(formData);
  const parsed = registrationFormSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors, values };
  }

  let orderId: string;
  try {
    const d = parsed.data;
    orderId = (
      await ordersService.createOrder({
        eventSlug,
        ticketTypeId: d.ticketTypeId,
        quantity: d.quantity,
        buyerName: d.buyerName,
        buyerEmail: d.buyerEmail,
        buyerPhone: d.buyerPhone,
        attendeeNames: d.attendeeNames,
      })
    ).id;
  } catch (err: unknown) {
    return { banner: toBanner(err), values };
  }

  redirect(`/orders/${orderId}`);
}

function toBanner(err: unknown): NonNullable<RegistrationFormState['banner']> {
  if (err instanceof SoldOutError) {
    return {
      title: 'That ticket type sold out while you were choosing',
      body: 'Nothing has been charged. Pick another ticket type or a smaller quantity to carry on.',
      soldOutTicketTypeId: err.ticketTypeId,
    };
  }
  if (err instanceof RegistrationClosedError || err instanceof EventNotFoundError) {
    return {
      title: 'Registration is not open',
      body: 'The registration window for this event has closed or has not opened yet.',
    };
  }
  if (err instanceof TicketTypeNotOnSaleError || err instanceof TicketTypeNotFoundError) {
    return {
      title: 'That ticket type is not on sale',
      body: 'Its sales window is over or has not started. Choose another ticket type.',
    };
  }
  if (err instanceof InvalidQuantityError) {
    return {
      title: 'Choose between 1 and 10 tickets',
      body: 'One ticket type per order, up to 10.',
    };
  }
  // Infrastructure failure — never disguise it as the buyer's mistake.
  console.error('register action: unexpected error', err);
  return {
    title: 'We could not place your order',
    body: 'Nothing has been charged. Please try again in a moment.',
  };
}
