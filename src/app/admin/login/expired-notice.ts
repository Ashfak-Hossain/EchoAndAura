/**
 * ADR-049: why the two-factor step sent the admin back to the password
 * (`?expired=` on /admin/login, set by the verify action). Out of tries is
 * worded apart from a timeout: the 6th code is refused unchecked, so a
 * right code typed then must not read as "too slow".
 */
export function expiredNotice(expired: string | undefined): string | null {
  if (!expired) return null;
  if (expired === 'attempts') {
    return 'Too many wrong codes for this sign-in. Enter your password again.';
  }
  return 'Your sign-in timed out. Enter your password again.';
}
