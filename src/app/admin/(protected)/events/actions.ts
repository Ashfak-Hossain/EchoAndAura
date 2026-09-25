'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { z } from 'zod';
import { eventsService } from '@/server/container';
import { EventNotFoundError, EventSlugTakenError, SponsorNotFoundError } from '@/server/lib/errors';
import { eventFormSchema } from '@/lib/validation/events';
import type { EventFormValues } from './event-form';
import { requireAdmin } from '@/lib/session';

/** The one field whose error shows beside it; every other error is the banner. */
export type EventFormField = 'presentingSponsorId';

export interface EventFormState {
  error?: string;
  field?: EventFormField;
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
    venueHidden: formData.get('venueHidden') === 'on',
    venueArea: str('venueArea'),
    startsAt: str('startsAt'),
    endsAt: str('endsAt'),
    registrationOpensAt: str('registrationOpensAt'),
    registrationClosesAt: str('registrationClosesAt'),
    presentingSponsorId: str('presentingSponsorId'),
  };
}

function invalid(error: z.ZodError, values: EventFormValues): EventFormState {
  const issue = error.issues[0];
  return {
    error: issue?.message ?? 'Invalid input',
    field: issue?.path[0] === 'presentingSponsorId' ? 'presentingSponsorId' : undefined,
    values,
  };
}

function failed(err: unknown, values: EventFormValues): EventFormState {
  // The sponsor was deleted while the form was open (the FK refused it).
  if (err instanceof SponsorNotFoundError) {
    return {
      error: 'That sponsor has been deleted. Choose another, or None.',
      field: 'presentingSponsorId',
      values,
    };
  }
  return { error: toMessage(err), values };
}

/** Thin: Zod parse → service → map known errors / redirect. */
export async function createEventAction(
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  await requireAdmin();
  const values = submittedValues(formData);
  const parsed = eventFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, values);

  let id: string;
  try {
    id = (await eventsService.createEvent(parsed.data)).id;
  } catch (err: unknown) {
    return failed(err, values);
  }

  revalidatePath('/admin/events');
  redirect(`/admin/events/${id}/edit`);
}

export async function updateEventAction(
  id: string,
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  await requireAdmin();
  const values = submittedValues(formData);
  const parsed = eventFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, values);

  try {
    await eventsService.updateEvent(id, parsed.data);
  } catch (err: unknown) {
    return failed(err, values);
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
