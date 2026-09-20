import { describe, expect, it } from 'vitest';
import { formatSort, nextSort, parseSort, sortHref } from '@/lib/table-sort';

const ALLOWED = ['created', 'total'] as const;
const DEFAULT = { column: 'created', desc: true } as const;

describe('parseSort', () => {
  it('accepts only whitelisted columns with an explicit direction', () => {
    expect(parseSort('total:asc', ALLOWED, DEFAULT)).toEqual({ column: 'total', desc: false });
    expect(parseSort('created:desc', ALLOWED, DEFAULT)).toEqual({ column: 'created', desc: true });
  });
  it('falls back for anything else — an injected column name never reaches SQL', () => {
    for (const bad of [
      undefined,
      null,
      '',
      'total',
      'total:up',
      'buyer_email:asc',
      'total:asc:x',
      ';drop',
    ]) {
      expect(parseSort(bad, ALLOWED, DEFAULT)).toEqual(DEFAULT);
    }
  });
});

describe('nextSort / formatSort / sortHref', () => {
  it('a new column starts with its natural direction; the same column flips', () => {
    expect(nextSort(DEFAULT, 'total', true)).toEqual({ column: 'total', desc: true });
    expect(nextSort(DEFAULT, 'total', false)).toEqual({ column: 'total', desc: false });
    expect(nextSort(DEFAULT, 'created')).toEqual({ column: 'created', desc: false });
  });
  it('round-trips through the query string and drops the page', () => {
    const sort = { column: 'total', desc: true };
    expect(formatSort(sort)).toBe('total:desc');
    expect(sortHref('/admin/orders', '?q=abc&page=3', sort)).toBe(
      '/admin/orders?q=abc&sort=total%3Adesc',
    );
    expect(sortHref('/admin/orders', '', sort)).toBe('/admin/orders?sort=total%3Adesc');
    expect(parseSort('total%3Adesc'.replace('%3A', ':'), ALLOWED, DEFAULT)).toEqual(sort);
  });
});
