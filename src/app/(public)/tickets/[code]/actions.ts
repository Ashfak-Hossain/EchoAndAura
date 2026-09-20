'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ticketsService } from '@/server/container';
import {
  InvalidAttendeeNameError,
  RenameLockedError,
  TicketCancelledError,
  TicketNotFoundError,
  TicketRenameConflictError,
} from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import { formatDhakaLong } from '@/lib/time';
import { personName } from '@/lib/validation/orders';

export interface RenameState {
  error?: string;
  /** The saved name, so the form can close and the page can announce it. */
  saved?: string;
  /** Distinguishes one successful save from the next (same name twice). */
  savedAt?: number;
}

const schema = z.object({ attendeeName: personName('the name the guest will give at the door') });

/** Thin: Zod → ticketsService.renameAttendee → revalidate. */
export async function renameAttendeeAction(
  code: string,
  prev: RenameState,
  formData: FormData,
): Promise<RenameState> {
  const parsed = schema.safeParse({ attendeeName: formData.get('attendeeName') });
  // Errors keep the previous save's stamp so the form stays open and shows them.
  if (!parsed.success) {
    return { ...prev, error: parsed.error.issues[0]?.message ?? 'Invalid name' };
  }

  try {
    const ticket = await ticketsService.renameAttendee(code, parsed.data.attendeeName);
    revalidatePath(`/tickets/${code}`);
    return { saved: ticket.attendeeName, savedAt: Date.now() };
  } catch (err: unknown) {
    return { ...prev, error: toMessage(err) };
  }
}

function toMessage(err: unknown): string {
  if (err instanceof RenameLockedError) {
    return err.lockedAt
      ? `Names locked when registration closed on ${formatDhakaLong(err.lockedAt)} (Dhaka). The door list is already printed — if you need a change, message the organizer.`
      : 'Names are locked for this event. Message the organizer if you need a change.';
  }
  if (err instanceof TicketCancelledError)
    return 'This ticket was cancelled and cannot be renamed.';
  if (err instanceof TicketRenameConflictError) {
    return 'This ticket changed while you were editing — reload the page and try again.';
  }
  if (err instanceof InvalidAttendeeNameError) return err.message;
  if (err instanceof TicketNotFoundError) return 'This ticket no longer exists.';
  logger.error(
    { err: err instanceof Error ? { name: err.name, message: err.message } : err },
    'rename action: unexpected error',
  );
  return 'We could not save the name. Please try again in a moment.';
}
