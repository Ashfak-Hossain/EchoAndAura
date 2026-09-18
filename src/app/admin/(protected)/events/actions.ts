'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eventsService } from '@/server/container';
import { EventNotFoundError, EventSlugTakenError } from '@/server/lib/errors';
import { eventFormSchema } from '@/lib/validation/events';
import type { EventFormValues } from './event-form';

export interface EventFormState {
  error?: string;
  /** What was submitted — React resets uncontrolled fields after an action, so
   *  the form re-seeds from these instead of wiping the organizer's input. */
  values?: EventFormValues;
}

function submittedValues(formData: FormData): EventFormValues {
  const str = (key: keyof EventFormValues) => {
    const v = formData.get(key);
    return typeof v === 'string' ? v : '';
  };
  return {
    title: str('title'),
    slug: str('slug'),
    description: str('description'),
    venue: str('venue'),
    startsAt: str('startsAt'),
    endsAt: str('endsAt'),
    registrationOpensAt: str('registrationOpensAt'),
    registrationClosesAt: str('registrationClosesAt'),
  };
}

/** Thin: Zod parse → service → map known errors / redirect. */
export async function createEventAction(
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const values = submittedValues(formData);
  const parsed = eventFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input', values };
  }

  let id: string;
  try {
    id = (await eventsService.createEvent(parsed.data)).id;
  } catch (err: unknown) {
    return { error: toMessage(err), values };
  }

  revalidatePath('/admin/events');
  redirect(`/admin/events/${id}/edit`);
}

export async function updateEventAction(
  id: string,
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const values = submittedValues(formData);
  const parsed = eventFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input', values };
  }

  try {
    await eventsService.updateEvent(id, parsed.data);
  } catch (err: unknown) {
    return { error: toMessage(err), values };
  }

  revalidatePath('/admin/events');
  redirect(`/admin/events/${id}/edit?saved=1`);
}

function toMessage(err: unknown): string {
  if (err instanceof EventSlugTakenError) return 'That URL slug is already in use';
  if (err instanceof EventNotFoundError) return 'This event no longer exists';
  // Infrastructure failure — never disguise it as a form problem.
  console.error('events action: unexpected error', err);
  return 'Could not save the event. Please try again.';
}
