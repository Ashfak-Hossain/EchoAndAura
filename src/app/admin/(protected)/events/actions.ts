'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eventsService } from '@/server/container';
import { EventNotFoundError, EventSlugTakenError } from '@/server/lib/errors';
import { eventFormSchema } from '@/lib/validation/events';

export interface EventFormState {
  error?: string;
}

/** Thin: Zod parse → service → map known errors / redirect. */
export async function createEventAction(
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const parsed = eventFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  let id: string;
  try {
    id = (await eventsService.createEvent(parsed.data)).id;
  } catch (err: unknown) {
    return { error: toMessage(err) };
  }

  revalidatePath('/admin/events');
  redirect(`/admin/events/${id}/edit`);
}

export async function updateEventAction(
  id: string,
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const parsed = eventFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  try {
    await eventsService.updateEvent(id, parsed.data);
  } catch (err: unknown) {
    return { error: toMessage(err) };
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
