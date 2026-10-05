/**
 * ADR-060: a buyer on a Bangla keyboard types `০১৭১২…`, and JavaScript's
 * `\d` matches ASCII digits only — so their bKash number, TrxID or ticket
 * code failed every check. Every numeric or code input passes through this
 * first, so what is checked, compared and stored is always ASCII (a TrxID
 * typed in Bangla digits still meets the UNIQUE index as itself,
 * Invariant 3).
 */

/** The zero of each digit set people here may type: Bangla, Arabic-Indic, Persian. */
const ZEROS = [0x09e6, 0x0660, 0x06f0];

const OTHER_DIGITS = /[০-৯٠-٩۰-۹]/g;

export function normaliseDigits(value: string): string {
  return value.replace(OTHER_DIGITS, (ch) => {
    const code = ch.charCodeAt(0);
    const zero = ZEROS.find((z) => code >= z && code <= z + 9)!;
    return String(code - zero);
  });
}
