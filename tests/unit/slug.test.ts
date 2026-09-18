import { describe, expect, it } from 'vitest';
import { SLUG_MAX_LENGTH, slugify } from '@/server/lib/slug';

describe('slugify', () => {
  it('lowercases and joins words with single dashes', () => {
    expect(slugify('Launch Night 2026')).toBe('launch-night-2026');
  });

  it('strips punctuation and collapses runs of separators', () => {
    expect(slugify("Raj's  Launch -- Night!!")).toBe('raj-s-launch-night');
  });

  it('strips accents and trims leading/trailing dashes', () => {
    expect(slugify('  Café Été  ')).toBe('cafe-ete');
  });

  it('caps the length without leaving a trailing dash', () => {
    const slug = slugify('a '.repeat(100));
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
  });

  // Failure path: a slug must never be persisted empty.
  it('throws when nothing usable remains', () => {
    expect(() => slugify('!!! ---')).toThrow(RangeError);
    expect(() => slugify('')).toThrow(RangeError);
  });
});
