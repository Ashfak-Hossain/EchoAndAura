import { formatSort } from '@/lib/table-sort';
import { ORDERS_DEFAULT_SORT, type OrdersSearchInput } from '@/lib/validation/orders-search';

/** The current filters as a query string, for the CSV link and the pager. */
export function searchQuery(input: OrdersSearchInput, page?: number): string {
  const p = new URLSearchParams();
  if (input.q) p.set('q', input.q);
  if (input.status) p.set('status', input.status);
  if (input.event) p.set('event', input.event);
  if (input.from) p.set('from', input.from);
  if (input.to) p.set('to', input.to);
  if (
    input.sort.column !== ORDERS_DEFAULT_SORT.column ||
    input.sort.desc !== ORDERS_DEFAULT_SORT.desc
  ) {
    p.set('sort', formatSort(input.sort));
  }
  if (input.size && input.size !== 25) p.set('size', String(input.size));
  if (page && page > 1) p.set('page', String(page));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** The same query with one filter replaced (for the status tiles and sort links). */
export function withStatus(input: OrdersSearchInput, status: OrdersSearchInput['status']): string {
  return `/admin/orders${searchQuery({ ...input, status })}`;
}
