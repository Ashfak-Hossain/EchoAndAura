import { describe, expect, it } from 'vitest';
import {
  CHECK_IN_DEFAULT_SORT,
  type CheckInEntry,
  filterCheckInRows,
  isEmptyCheckInQuery,
  normaliseCheckInQuery,
  sortCheckInRows,
} from '@/server/lib/check-in';
import { checkInQuerySchema } from '@/lib/validation/check-in';

const rows: CheckInEntry[] = [
  {
    id: '1',
    attendeeName: 'Farhana Rahman',
    ticketTypeName: 'General',
    code: 'TKT-6BN4RT7K',
    orderReference: 'EA-7K3M9Q',
  },
  {
    id: '2',
    attendeeName: 'Imran Hossain',
    ticketTypeName: 'VIP',
    code: 'TKT-2XR7VC9M',
    orderReference: 'EA-2P8M4T',
  },
  {
    id: '3',
    attendeeName: 'Nusrat Jahan',
    ticketTypeName: 'General',
    code: 'TKT-4H8ZP2XQ',
    orderReference: 'EA-7K3M9Q',
  },
  {
    id: '4',
    attendeeName: 'নুসরাত জাহান',
    ticketTypeName: 'Early Bird',
    code: 'TKT-8MD3WN6V',
    orderReference: 'EA-3M7YD2',
  },
  {
    id: '5',
    attendeeName: 'imran hossain',
    ticketTypeName: 'General',
    code: 'TKT-5YT3QK7B',
    orderReference: 'EA-4D2XN6',
  },
];

describe('normaliseCheckInQuery', () => {
  it('is empty for blank input', () => {
    expect(normaliseCheckInQuery('   ')).toEqual({ name: null, code: null, reference: null });
    expect(isEmptyCheckInQuery(normaliseCheckInQuery(''))).toBe(true);
  });

  it('reads a ticket code with or without its prefix, in any case', () => {
    expect(normaliseCheckInQuery('tkt-6bn4rt7k').code).toBe('TKT-6BN4RT7K');
    expect(normaliseCheckInQuery('6BN4RT7K').code).toBe('TKT-6BN4RT7K');
    expect(normaliseCheckInQuery('tkt6bn4rt7k').code).toBe('TKT-6BN4RT7K');
    expect(normaliseCheckInQuery('tkt 6bn4 rt7k').code).toBe('TKT-6BN4RT7K');
    // Ambiguous alphabet: 0/O and 1/I/L never appear in a real code.
    expect(normaliseCheckInQuery('TKT-6BN4RT10').code).toBeNull();
  });

  it('reads an order reference with or without its prefix', () => {
    expect(normaliseCheckInQuery('ea-7k3m9q').reference).toBe('EA-7K3M9Q');
    expect(normaliseCheckInQuery('7K3M9Q').reference).toBe('EA-7K3M9Q');
    expect(normaliseCheckInQuery('7K3M9').reference).toBeNull();
  });

  it('always keeps the name reading, collapsed and lower-cased', () => {
    expect(normaliseCheckInQuery('  Farhana   RAHMAN ')).toEqual({
      name: 'farhana rahman',
      code: null,
      reference: null,
    });
    // A six-character word is a name AND a possible reference.
    expect(normaliseCheckInQuery('Nusrat')).toEqual({
      name: 'nusrat',
      code: null,
      reference: 'EA-NUSRAT',
    });
  });
});

describe('filterCheckInRows', () => {
  it('returns every row for an empty query', () => {
    expect(filterCheckInRows(rows, normaliseCheckInQuery(''))).toHaveLength(5);
  });

  it('matches names as a case- and whitespace-insensitive substring, including Bangla', () => {
    expect(
      filterCheckInRows(rows, normaliseCheckInQuery('IMRAN  hossain')).map((r) => r.id),
    ).toEqual(['2', '5']);
    expect(filterCheckInRows(rows, normaliseCheckInQuery('rahm')).map((r) => r.id)).toEqual(['1']);
    expect(filterCheckInRows(rows, normaliseCheckInQuery('জাহান')).map((r) => r.id)).toEqual(['4']);
  });

  it('matches a code or a reference exactly', () => {
    expect(filterCheckInRows(rows, normaliseCheckInQuery('2xr7vc9m')).map((r) => r.id)).toEqual([
      '2',
    ]);
    expect(filterCheckInRows(rows, normaliseCheckInQuery('EA-7K3M9Q')).map((r) => r.id)).toEqual([
      '1',
      '3',
    ]);
    // A partial code is not a code and is not a name either.
    expect(filterCheckInRows(rows, normaliseCheckInQuery('2XR7VC'))).toEqual([]);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterCheckInRows(rows, normaliseCheckInQuery('nobody here'))).toEqual([]);
  });
});

describe('sortCheckInRows', () => {
  it('defaults to name A–Z, case-insensitively', () => {
    expect(sortCheckInRows(rows, CHECK_IN_DEFAULT_SORT).map((r) => r.id)).toEqual([
      '1',
      '2',
      '5',
      '3',
      '4',
    ]);
  });

  it('sorts every column both ways with the code as a stable tiebreak', () => {
    const ids = (column: 'name' | 'type' | 'code' | 'order', desc: boolean) =>
      sortCheckInRows(rows, { column, desc }).map((r) => r.id);
    expect(ids('name', true)).toEqual(['4', '3', '2', '5', '1']);
    // Two "General" rows (1, 3, 5) tie on type → ordered by code 4H8… < 5YT… < 6BN….
    expect(ids('type', false)).toEqual(['4', '3', '5', '1', '2']);
    expect(ids('type', true)).toEqual(['2', '3', '5', '1', '4']);
    expect(ids('code', false)).toEqual(['2', '3', '5', '1', '4']);
    expect(ids('code', true)).toEqual(['4', '1', '5', '3', '2']);
    // Rows 1 and 3 share EA-7K3M9Q → ordered by code within the tie.
    expect(ids('order', false)).toEqual(['2', '4', '5', '3', '1']);
    expect(ids('order', true)).toEqual(['3', '1', '5', '4', '2']);
  });

  it('does not mutate its input', () => {
    const copy = [...rows];
    sortCheckInRows(rows, { column: 'code', desc: true });
    expect(rows).toEqual(copy);
  });
});

describe('checkInQuerySchema', () => {
  it('trims and clips q, falls back to name A–Z on a bad sort', () => {
    const parsed = checkInQuerySchema.parse({ q: `  ${'x'.repeat(100)}  `, sort: 'nope:up' });
    expect(parsed.q).toHaveLength(80);
    expect(parsed.sort).toEqual(CHECK_IN_DEFAULT_SORT);
    expect(checkInQuerySchema.parse({})).toEqual({
      q: '',
      sort: CHECK_IN_DEFAULT_SORT,
      show: 'all',
    });
    // ADR-030 filter: lenient like the rest — unknown means everyone.
    expect(checkInQuerySchema.parse({ show: 'in' }).show).toBe('in');
    expect(checkInQuerySchema.parse({ show: 'out' }).show).toBe('out');
    expect(checkInQuerySchema.parse({ show: 'IN; drop' }).show).toBe('all');
    expect(checkInQuerySchema.parse({ sort: 'code:desc' }).sort).toEqual({
      column: 'code',
      desc: true,
    });
  });
});
