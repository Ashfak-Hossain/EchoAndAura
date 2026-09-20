'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { eventStatus } from '@/db/schema';
import { eventsService } from '@/server/container';
import {
  EventNotFoundError,
  EventNotPublishableError,
  EventStatusConflictError,
  InvalidEventTransitionError,
} from '@/server/lib/errors';
import { editorPath } from '../editor-path';
import { requireAdmin } from '@/lib/session';

export interface StatusActionState {
  error?: string;
}

// Bound per button by the page (no form fields to parse). `to` is
// re-validated here so a tampered form can't inject a status value the enum
// doesn't know.
export async function changeEventStatusAction(
  eventId: string,
  to: string,
): Promise<StatusActionState> {
  await requireAdmin();
  const parsed = z.enum(eventStatus.enumValues).safeParse(to);
  if (!parsed.success) return { error: 'Unknown status' };

  try {
    await eventsService.changeEventStatus(eventId, parsed.data);
  } catch (err: unknown) {
    return { error: toMessage(err) };
  }

  revalidatePath(editorPath(eventId, 'publish'));
  revalidatePath('/admin/events');
  return {};
}

function toMessage(err: unknown): string {
  if (err instanceof EventNotPublishableError) {
    return `Not ready to publish: ${err.problems.join('; ')}`;
  }
  if (err instanceof InvalidEventTransitionError) {
    return 'That change is not allowed from the current status';
  }
  if (err instanceof EventStatusConflictError) {
    return 'The status was changed elsewhere — reload and try again';
  }
  if (err instanceof EventNotFoundError) return 'This event no longer exists';
  // Infrastructure failure — never disguise it as a rule violation.
  console.error('status action: unexpected error', err);
  return 'Could not change the status. Please try again.';
}
