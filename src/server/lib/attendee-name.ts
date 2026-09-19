/**
 * One rule for a person's name, shared by the Zod boundary (registration,
 * rename) and the tickets service, so the two can never disagree.
 */
export const NAME_MIN = 2;
export const NAME_MAX = 120;

/** Trimmed, whitespace-collapsed; null when the rule fails. */
export function normaliseAttendeeName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < NAME_MIN || name.length > NAME_MAX) return null;
  return name;
}
