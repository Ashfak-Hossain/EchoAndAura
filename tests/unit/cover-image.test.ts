import { describe, expect, it } from 'vitest';
import {
  COVER_IMAGE_MAX_BYTES,
  coverImageKey,
  isCoverKeyForEvent,
  validateCoverImage,
} from '@/server/lib/cover-image';
import { CoverImageInvalidError } from '@/server/lib/errors';

const EVENT = '11111111-1111-4111-8111-111111111111';

describe('validateCoverImage', () => {
  it('accepts JPEG, PNG and WebP within the size limit', () => {
    for (const contentType of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(() => validateCoverImage({ contentType, size: 1 })).not.toThrow();
      expect(() =>
        validateCoverImage({ contentType, size: COVER_IMAGE_MAX_BYTES }),
      ).not.toThrow();
    }
  });

  // Failure paths: the browser's claim is untrusted input.
  it('rejects other types', () => {
    for (const contentType of ['image/gif', 'image/svg+xml', 'text/plain', 'application/pdf', '']) {
      expect(() => validateCoverImage({ contentType, size: 100 })).toThrow(CoverImageInvalidError);
    }
  });

  it('rejects empty, fractional, and oversized files', () => {
    expect(() => validateCoverImage({ contentType: 'image/png', size: 0 })).toThrow(/empty/);
    expect(() => validateCoverImage({ contentType: 'image/png', size: 1.5 })).toThrow(/empty/);
    expect(() =>
      validateCoverImage({ contentType: 'image/png', size: COVER_IMAGE_MAX_BYTES + 1 }),
    ).toThrow(/5 MB/);
  });
});

describe('coverImageKey / isCoverKeyForEvent', () => {
  it('issues keys under the event prefix with the right extension, unique per call', () => {
    const a = coverImageKey(EVENT, 'image/jpeg');
    const b = coverImageKey(EVENT, 'image/jpeg');
    expect(a).toMatch(new RegExp(`^events/${EVENT}/cover-[A-Za-z0-9_-]{12}\\.jpg$`));
    expect(a).not.toBe(b);
    expect(coverImageKey(EVENT, 'image/webp')).toMatch(/\.webp$/);
    expect(isCoverKeyForEvent(a, EVENT)).toBe(true);
  });

  it('rejects keys for other events, traversal, and foreign shapes', () => {
    const other = '22222222-2222-4222-8222-222222222222';
    const good = coverImageKey(EVENT, 'image/png');
    expect(isCoverKeyForEvent(good, other)).toBe(false);
    expect(isCoverKeyForEvent(`events/${EVENT}/../${other}/cover-abcdefghijkl.png`, EVENT)).toBe(
      false,
    );
    expect(isCoverKeyForEvent(`events/${EVENT}/anything.png`, EVENT)).toBe(false);
    expect(isCoverKeyForEvent(`events/${EVENT}/cover-abcdefghijkl.exe`, EVENT)).toBe(false);
    expect(isCoverKeyForEvent('', EVENT)).toBe(false);
  });

  it('refuses to build a key for a disallowed type', () => {
    expect(() => coverImageKey(EVENT, 'image/gif')).toThrow(CoverImageInvalidError);
  });
});
