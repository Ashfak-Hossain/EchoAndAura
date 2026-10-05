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

const BANGLA_ZERO = 0x09e6;

/** ASCII digits → Bangla (`2026` → `২০২৬`); everything else untouched. For display only. */
export function toBanglaDigits(value: string): string {
  return value.replace(/[0-9]/g, (d) => String.fromCharCode(BANGLA_ZERO + Number(d)));
}

/**
 * Whole-number grouping: English in thousands (`1,234,567`), Bangla in the
 * South Asian way — the last three digits, then pairs — in Bangla digits
 * (`১২,৩৪,৫৬৭`). By hand, not `Intl`: server and phone must print the same.
 */
export function groupDigits(whole: number, locale: 'en' | 'bn' = 'en'): string {
  const s = Math.trunc(Math.abs(whole)).toString();
  const sign = whole < 0 ? '-' : '';
  if (locale === 'en') return sign + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const last = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return sign + toBanglaDigits(rest ? `${rest},${last}` : last);
}
