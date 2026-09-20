import type { OrdersSearchInput } from '@/lib/validation/orders-search';

/** The current filters as a query string, for the CSV link and the pager. */
export function searchQuery(input: OrdersSearchInput, page?: number): string {
  const p = new URLSearchParams();
  if (input.q) p.set('q', input.q);
  if (input.status) p.set('status', input.status);
  if (input.event) p.set('event', input.event);
  if (input.from) p.set('from', input.from);
  if (input.to) p.set('to', input.to);
  if (page && page > 1) p.set('page', String(page));
  const s = p.toString();
  return s ? `?${s}` : '';
}
