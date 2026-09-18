import { nanoid } from 'nanoid';
import { CoverImageInvalidError } from '@/server/lib/errors';

/**
 * Cover image rules, shared by the pre-upload check (what the browser says
 * it will send) and the post-upload check (what storage says it received).
 * Both must agree before a key is written to the event.
 */

export const COVER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Accepted MIME types and the file extension each is stored under. */
export const COVER_IMAGE_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface CoverImageMeta {
  contentType: string;
  size: number;
}

/** @throws CoverImageInvalidError */
export function validateCoverImage({ contentType, size }: CoverImageMeta): void {
  if (!(contentType in COVER_IMAGE_TYPES)) {
    throw new CoverImageInvalidError('Cover image must be a JPEG, PNG or WebP');
  }
  if (!Number.isInteger(size) || size <= 0) {
    throw new CoverImageInvalidError('Cover image is empty');
  }
  if (size > COVER_IMAGE_MAX_BYTES) {
    throw new CoverImageInvalidError('Cover image must be 5 MB or smaller');
  }
}

/** Objects for an event live under one prefix so ownership is checkable. */
export function coverImagePrefix(eventId: string): string {
  return `events/${eventId}/`;
}

/** Fresh key per upload — replacing an image never overwrites in place. */
export function coverImageKey(eventId: string, contentType: string): string {
  const ext = COVER_IMAGE_TYPES[contentType];
  if (!ext) throw new CoverImageInvalidError('Cover image must be a JPEG, PNG or WebP');
  return `${coverImagePrefix(eventId)}cover-${nanoid(12)}.${ext}`;
}

/** True only for keys this event could have been issued: exact prefix, one segment, no traversal. */
export function isCoverKeyForEvent(key: string, eventId: string): boolean {
  const prefix = coverImagePrefix(eventId);
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  return /^cover-[A-Za-z0-9_-]{12}\.(jpg|png|webp)$/.test(rest);
}
