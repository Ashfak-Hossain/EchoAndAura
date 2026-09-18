'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ticketTypesService } from '@/server/container';
import {
  EventNotFoundError,
  TicketTypeCapacityTooLowError,
  TicketTypeInUseError,
  TicketTypeNotFoundError,
} from '@/server/lib/errors';
import { ticketTypeFormSchema } from '@/lib/validation/ticket-types';
import { editorPath } from '../editor-path';
import type { TicketTypeFormValues } from './ticket-type-form';

export interface TicketTypeFormState {
  error?: string;
  /** What was submitted — React resets uncontrolled fields after an action, so
   *  the form re-seeds from these instead of wiping the organizer's input. */
  values?: TicketTypeFormValues;
}

const eventEditPath = (eventId: string) => editorPath(eventId, 'ticket-types');

function submittedValues(formData: FormData): TicketTypeFormValues {
  const str = (key: keyof TicketTypeFormValues) => {
    const v = formData.get(key);
    return typeof v === 'string' ? v : '';
  };
  return {
    name: str('name'),
    priceTaka: str('priceTaka'),
    quantityTotal: str('quantityTotal'),
    salesStartsAt: str('salesStartsAt'),
    salesEndsAt: str('salesEndsAt'),
  };
}

/** Thin: Zod parse → service → map known errors / redirect. */
export async function createTicketTypeAction(
  eventId: string,
  _prev: TicketTypeFormState,
  formData: FormData,
): Promise<TicketTypeFormState> {
  const values = submittedValues(formData);
  const parsed = ticketTypeFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
      values,
    };
  }

  try {
    await ticketTypesService.createTicketType(eventId, parsed.data);
  } catch (err: unknown) {
    return { error: toMessage(err), values };
  }

  revalidatePath(eventEditPath(eventId));
  redirect(eventEditPath(eventId));
}

export async function updateTicketTypeAction(
  eventId: string,
  ticketTypeId: string,
  _prev: TicketTypeFormState,
  formData: FormData,
): Promise<TicketTypeFormState> {
  const values = submittedValues(formData);
  const parsed = ticketTypeFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
      values,
    };
  }

  try {
    await ticketTypesService.updateTicketType(ticketTypeId, parsed.data);
  } catch (err: unknown) {
    return { error: toMessage(err), values };
  }

  revalidatePath(eventEditPath(eventId));
  redirect(eventEditPath(eventId));
}

/** Bound to (eventId, ticketTypeId) by the page; no form fields to parse. */
export async function deleteTicketTypeAction(
  eventId: string,
  ticketTypeId: string,
): Promise<TicketTypeFormState> {
  try {
    await ticketTypesService.deleteTicketType(ticketTypeId);
  } catch (err: unknown) {
    return { error: toMessage(err) };
  }

  revalidatePath(eventEditPath(eventId));
  redirect(eventEditPath(eventId));
}

function toMessage(err: unknown): string {
  if (err instanceof TicketTypeCapacityTooLowError) {
    return 'Quantity cannot be lower than the tickets already sold or held';
  }
  if (err instanceof TicketTypeInUseError) {
    return 'This ticket type has orders and cannot be deleted';
  }
  if (err instanceof TicketTypeNotFoundError) return 'This ticket type no longer exists';
  if (err instanceof EventNotFoundError) return 'This event no longer exists';
  // Infrastructure failure — never disguise it as a form problem.
  console.error('ticket-types action: unexpected error', err);
  return 'Could not save the ticket type. Please try again.';
}
