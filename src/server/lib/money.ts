/**
 * Money handling — the ONLY place taka⇄paisa conversion lives.
 * Everywhere else money is integer paisa: `number` in code,
 * BIGINT in the database. Never use floats for money.
 *
 * Why integers: in IEEE-754, 0.1 + 0.2 !== 0.3. Representing money as floating
 * taka drifts by fractions of a paisa that accumulate into real discrepancies
 * across thousands of orders. Integer paisa is exact.
 */

/** 1 taka = 100 paisa. */
export const PAISA_PER_TAKA = 100;

/**
 * A paisa amount must be a non-negative, safe integer. Past MAX_SAFE_INTEGER,
 * JS number arithmetic is no longer exact — reject rather than silently
 * corrupt a total.
 */
export function assertValidPaisa(paisa: number): void {
  if (!Number.isInteger(paisa)) {
    throw new RangeError(`paisa must be an integer, got ${paisa}`);
  }
  if (paisa < 0) {
    throw new RangeError(`paisa must be non-negative, got ${paisa}`);
  }
  if (paisa > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`paisa exceeds MAX_SAFE_INTEGER: ${paisa}`);
  }
}

/**
 * Convert taka (which may carry up to 2 decimal places) to integer paisa.
 * Rounds to the nearest paisa to absorb float representation error — e.g.
 * 19.99 * 100 === 1998.9999999999998, which must become 1999, not 1998.
 */
export function takaToPaisa(taka: number): number {
  if (!Number.isFinite(taka)) {
    throw new RangeError(`taka must be a finite number, got ${taka}`);
  }
  if (taka < 0) {
    throw new RangeError(`taka must be non-negative, got ${taka}`);
  }
  const paisa = Math.round(taka * PAISA_PER_TAKA);
  assertValidPaisa(paisa);
  return paisa;
}

/**
 * Convert integer paisa back to a taka number. For display/serialisation only —
 * do NOT do money math on the result; keep all arithmetic in paisa.
 */
export function paisaToTaka(paisa: number): number {
  assertValidPaisa(paisa);
  return paisa / PAISA_PER_TAKA;
}

/** Multiply a unit price (paisa) by an integer quantity, exactly. */
export function multiplyPaisa(paisa: number, quantity: number): number {
  assertValidPaisa(paisa);
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError(`quantity must be a non-negative integer, got ${quantity}`);
  }
  const result = paisa * quantity;
  assertValidPaisa(result);
  return result;
}

/** Sum any number of paisa amounts, validating each input and the total. */
export function sumPaisa(...amounts: number[]): number {
  let total = 0;
  for (const amount of amounts) {
    assertValidPaisa(amount);
    total += amount;
  }
  assertValidPaisa(total);
  return total;
}

/**
 * Format integer paisa as a Bangladeshi Taka string, e.g. 123456 → "৳1,234.56".
 * Grouping is done manually (not Intl currency) so output is deterministic
 * across environments/ICU builds and trivial to assert in tests.
 */
export function formatBDT(paisa: number): string {
  assertValidPaisa(paisa);
  const takaPart = Math.floor(paisa / PAISA_PER_TAKA);
  const paisaPart = paisa % PAISA_PER_TAKA;
  const grouped = takaPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `৳${grouped}.${paisaPart.toString().padStart(2, '0')}`;
}

/**
 * Plain decimal for spreadsheets, e.g. 123456 → "1234.56": no symbol, no
 * grouping, always two decimals, so a CSV column sums in Excel/Numbers.
 */
export function formatDecimalBDT(paisa: number): string {
  assertValidPaisa(paisa);
  const takaPart = Math.floor(paisa / PAISA_PER_TAKA);
  const paisaPart = paisa % PAISA_PER_TAKA;
  return `${takaPart}.${paisaPart.toString().padStart(2, '0')}`;
}
