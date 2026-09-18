'use server';

import { revalidatePath } from 'next/cache';
import { eventsService } from '@/server/container';
import {
  CoverImageInvalidError,
  CoverImageNotUploadedError,
  EventNotFoundError,
} from '@/server/lib/errors';
import { coverImageKeySchema, coverUploadRequestSchema } from '@/lib/validation/cover-image';

export type CoverActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Step 1: validate the browser's claim, hand back a presigned PUT. */
export async function createCoverUploadAction(
  eventId: string,
  input: unknown,
): Promise<CoverActionResult<{ uploadUrl: string; key: string }>> {
  const parsed = coverUploadRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Choose a JPEG, PNG or WebP up to 5 MB' };

  try {
    const target = await eventsService.createCoverUpload(eventId, parsed.data);
    return { ok: true, data: { uploadUrl: target.url, key: target.key } };
  } catch (err: unknown) {
    return { ok: false, error: toMessage(err) };
  }
}

/** Step 3: the browser uploaded to `key`; verify and record it. */
export async function setCoverImageAction(
  eventId: string,
  key: unknown,
): Promise<CoverActionResult> {
  const parsed = coverImageKeySchema.safeParse(key);
  if (!parsed.success) return { ok: false, error: 'Upload did not complete. Please try again.' };

  try {
    await eventsService.setCoverImage(eventId, parsed.data);
  } catch (err: unknown) {
    return { ok: false, error: toMessage(err) };
  }

  revalidatePath(`/admin/events/${eventId}/edit`);
  return { ok: true, data: undefined };
}

export async function removeCoverImageAction(eventId: string): Promise<CoverActionResult> {
  try {
    await eventsService.removeCoverImage(eventId);
  } catch (err: unknown) {
    return { ok: false, error: toMessage(err) };
  }

  revalidatePath(`/admin/events/${eventId}/edit`);
  return { ok: true, data: undefined };
}

function toMessage(err: unknown): string {
  if (err instanceof CoverImageInvalidError) return err.reason;
  if (err instanceof CoverImageNotUploadedError) {
    return 'Upload did not complete. Please try again.';
  }
  if (err instanceof EventNotFoundError) return 'This event no longer exists';
  // Infrastructure failure (storage unreachable, misconfigured) — say so.
  console.error('cover action: unexpected error', err);
  return 'Could not save the cover image. Please try again.';
}
