import type { SortState } from '@/lib/table-sort';
import { ORDER_REFERENCE_PATTERN } from './order-reference';
import { TICKET_CODE_PATTERN } from './ticket-code';

/**
 * B11 check-in list: pure search and sort over the rows the repository
 * returns. The list is unpaginated (a door list is bounded by capacity and
 * is printed whole), so filtering and ordering happen here, in memory, from
 * the URL — the same shape as the verification queue (ADR-022).
 */
export interface CheckInEntry {
  id: string;
  attendeeName: string;
  ticketTypeName: string;
  code: string;
  orderReference: string;
}

export const CHECK_IN_SORT_COLUMNS = ['name', 'type', 'code', 'order'] as const;
export type CheckInSortColumn = (typeof CHECK_IN_SORT_COLUMNS)[number];
/** Name A–Z: how door staff look people up. */
export const CHECK_IN_DEFAULT_SORT: SortState<CheckInSortColumn> = { column: 'name', desc: false };

/** Every way a typed term can be read. All that parse are kept and ORed. */
export interface CheckInQuery {
  /** Lower-cased, whitespace-collapsed substring of the attendee name. */
  name: string | null;
  /** `TKT-XXXXXXXX` when the term looks like a ticket code (prefix optional). */
  code: string | null;
  /** `EA-XXXXXX` when the term looks like an order reference (prefix optional). */
  reference: string | null;
}

const EMPTY_QUERY: CheckInQuery = { name: null, code: null, reference: null };

function collapse(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

/**
 * Normalise a search term the way the data is stored (codes and references
 * upper-case with their prefix; names compared case-insensitively) so that
 * "tkt-6bn4rt1k", "6BN4RT1K" and "Farhana  rahman" all find their row.
 */
export function normaliseCheckInQuery(raw: string): CheckInQuery {
  const term = collapse(raw);
  if (!term) return EMPTY_QUERY;
  // Codes are read aloud in groups ("TKT 6BN4 RT7K"): spaces are not part of them.
  const upper = term.toUpperCase().replace(/\s+/g, '');
  const asCode = `TKT-${upper.replace(/^TKT-?/, '')}`;
  const asReference = `EA-${upper.replace(/^EA-?/, '')}`;
  return {
    name: term.toLowerCase(),
    code: TICKET_CODE_PATTERN.test(asCode) ? asCode : null,
    reference: ORDER_REFERENCE_PATTERN.test(asReference) ? asReference : null,
  };
}

export function isEmptyCheckInQuery(query: CheckInQuery): boolean {
  return !query.name && !query.code && !query.reference;
}

/** Rows matching any interpretation of the query; every row when the query is empty. */
export function filterCheckInRows<T extends CheckInEntry>(
  rows: readonly T[],
  query: CheckInQuery,
): T[] {
  if (isEmptyCheckInQuery(query)) return [...rows];
  return rows.filter(
    (row) =>
      (query.name !== null && collapse(row.attendeeName).toLowerCase().includes(query.name)) ||
      (query.code !== null && row.code === query.code) ||
      (query.reference !== null && row.orderReference === query.reference),
  );
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function sortKey(row: CheckInEntry, column: CheckInSortColumn): string {
  switch (column) {
    case 'name':
      return row.attendeeName;
    case 'type':
      return row.ticketTypeName;
    case 'code':
      return row.code;
    case 'order':
      return row.orderReference;
  }
}

/** Stable: ties fall back to the code, which is unique, so a reload never reshuffles. */
export function sortCheckInRows<T extends CheckInEntry>(
  rows: readonly T[],
  sort: SortState<CheckInSortColumn>,
): T[] {
  const dir = sort.desc ? -1 : 1;
  return [...rows].sort(
    (a, b) =>
      dir * collator.compare(sortKey(a, sort.column), sortKey(b, sort.column)) ||
      collator.compare(a.code, b.code),
  );
}
