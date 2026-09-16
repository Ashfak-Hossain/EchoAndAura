/** Slugs are public URL segments: lowercase ASCII words joined by single dashes. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 80;

/**
 * Derive a URL slug from free text, e.g. "Raj's Launch Night 2026!" →
 * "raj-s-launch-night-2026". Accents are stripped (NFKD + remove combining
 * marks); everything that is not a-z/0-9 becomes a dash; runs of dashes
 * collapse. Throws if nothing usable remains, so callers never persist "".
 */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');

  if (!SLUG_PATTERN.test(slug)) {
    throw new RangeError(`Cannot derive a slug from "${input}"`);
  }
  return slug;
}
