/**
 * Sort state for the admin tables lives in the URL (`?sort=<column>:<asc|desc>`)
 * so sorting is a link: it works without JavaScript, the back button undoes
 * it, and the CSV export sees the same order. Pure helpers, unit-tested.
 */
export interface SortState<C extends string = string> {
  column: C;
  desc: boolean;
}

/** Parses `?sort=` against a whitelist; anything else is the default. */
export function parseSort<C extends string>(
  param: string | undefined | null,
  allowed: readonly C[],
  fallback: SortState<C>,
): SortState<C> {
  if (!param) return fallback;
  const parts = param.split(':');
  if (parts.length !== 2) return fallback;
  const [column, dir] = parts;
  if (!column || !(allowed as readonly string[]).includes(column)) return fallback;
  if (dir !== 'asc' && dir !== 'desc') return fallback;
  return { column: column as C, desc: dir === 'desc' };
}

export function formatSort(sort: SortState): string {
  return `${sort.column}:${sort.desc ? 'desc' : 'asc'}`;
}

/**
 * The sort a click on `column` should produce: a new column starts with
 * its natural direction (`firstDesc` for numbers/dates), the same column
 * flips.
 */
export function nextSort<C extends string>(
  current: SortState<C>,
  column: C,
  firstDesc = false,
): SortState<C> {
  if (current.column === column) return { column, desc: !current.desc };
  return { column, desc: firstDesc };
}

/** `base` query string (may be empty or start with `?`) with `sort` replaced and `page` dropped. */
export function sortHref(pathname: string, base: string, sort: SortState): string {
  const params = new URLSearchParams(base.startsWith('?') ? base.slice(1) : base);
  params.set('sort', formatSort(sort));
  params.delete('page');
  return `${pathname}?${params.toString()}`;
}
