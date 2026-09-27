'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  type ColumnDef,
  type ColumnVisibilityState,
  columnVisibilityFeature,
  createColumnHelper,
  type RowData,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { nextSort, type SortState, sortHref } from '@/lib/table-sort';
import { cn } from '@/lib/utils';
import { DataTableColumnsMenu } from './data-table-columns-menu';

/**
 * The admin's one data table (ADR-022), TanStack Table in server-controlled
 * mode: the page fetches, filters, sorts and paginates on the server (the
 * URL is the state); this component renders the rows it is given and owns
 * only column visibility. Sorting is a link per header, so it works without
 * JavaScript and the back button undoes it. Desktop only — pages keep
 * their phone card lists under `lg`.
 *
 * Layout: [toolbar slot ………………… Columns · actions slot] / table / footer
 * (rows per page · x–y of N · ‹ ›).
 */
export interface DataTableColumnMeta {
  /** Right-align numbers and money. */
  align?: 'left' | 'right';
  /** Extra classes on both header and cells. */
  className?: string;
  /** `?sort=` column this header sorts by; absent = not sortable. */
  sortKey?: string;
  /** Numbers and dates start descending. */
  sortDescFirst?: boolean;
  /** Cannot be hidden (the identifying column). */
  alwaysVisible?: boolean;
}

export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  columnVisibilityFeature,
  columnMeta: {} as DataTableColumnMeta,
});

export type DataTableFeatures = typeof dataTableFeatures;
export type DataTableColumn<TData extends RowData> = ColumnDef<DataTableFeatures, TData, unknown>;

/** `createColumnHelper` pre-bound to the admin's feature set. */
export function adminColumnHelper<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>();
}

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export interface DataTablePagination {
  page: number;
  pages: number;
  total: number;
  size: number;
  /** 1-based index of the first and last row on this page (0 when empty). */
  from: number;
  to: number;
}

/** `base` query with `page`/`size` replaced — links, not callbacks (client boundary). */
function pageHref(
  base: { pathname: string; query: string },
  patch: { page?: number; size?: number },
) {
  const params = new URLSearchParams(base.query.startsWith('?') ? base.query.slice(1) : base.query);
  if (patch.size !== undefined) {
    params.delete('page');
    if (patch.size === PAGE_SIZES[0]) params.delete('size');
    else params.set('size', String(patch.size));
  }
  if (patch.page !== undefined) {
    if (patch.page <= 1) params.delete('page');
    else params.set('page', String(patch.page));
  }
  const qs = params.toString();
  return qs ? `${base.pathname}?${qs}` : base.pathname;
}

/**
 * Props cross the server → client boundary, so they are plain data: rows
 * carry their own `id`, and sort links are built here from the page's
 * pathname + current query rather than passed as a function.
 */
export interface DataTableProps<TData extends RowData & { id: string }> {
  /** Namespaces the remembered column visibility (`admin.table.<id>`). */
  tableId: string;
  columns: readonly DataTableColumn<TData>[];
  data: readonly TData[];
  /** Current server sort; the header of that column shows the arrow. */
  sort: SortState;
  /** The page's path and current query string: sort, page and size links are built from it. */
  sortBase: { pathname: string; query: string };
  /** Left side of the toolbar: search and filters. */
  toolbar?: ReactNode;
  /** Right side of the toolbar, after the Columns menu: export and the like. */
  actions?: ReactNode;
  pagination?: DataTablePagination;
  /** Test id put on every body row. */
  rowTestId?: string;
  /** Rendered instead of the table when there are no rows. */
  empty?: ReactNode;
  className?: string;
}

function storageKey(tableId: string) {
  return `admin.table.${tableId}.columns`;
}

/**
 * Column visibility lives in localStorage (a per-viewer convenience, never
 * shared) and is read through `useSyncExternalStore`, so the server render
 * and the first client render agree (empty = defaults) and the remembered
 * choice appears on hydration without a setState-in-effect. The snapshot is
 * the raw string so React's equality check is cheap and stable.
 */
const VISIBILITY_EVENT = 'admin-table-visibility';

function subscribeVisibility(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(VISIBILITY_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(VISIBILITY_EVENT, onChange);
  };
}

function readVisibilityRaw(tableId: string): string {
  try {
    return window.localStorage.getItem(storageKey(tableId)) ?? '';
  } catch {
    return '';
  }
}

function parseVisibility(raw: string): ColumnVisibilityState {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === 'boolean'),
      ) as ColumnVisibilityState;
    }
  } catch {
    // Corrupt value: default visibility.
  }
  return {};
}

function writeVisibility(tableId: string, next: ColumnVisibilityState) {
  try {
    window.localStorage.setItem(storageKey(tableId), JSON.stringify(next));
  } catch {
    // Storage unavailable (private window): the change does not persist.
  }
  window.dispatchEvent(new Event(VISIBILITY_EVENT));
}

export function DataTable<TData extends RowData & { id: string }>({
  tableId,
  columns,
  data,
  sort,
  sortBase,
  toolbar,
  actions,
  pagination,
  rowTestId,
  empty,
  className,
}: DataTableProps<TData>) {
  const router = useRouter();
  const raw = useSyncExternalStore(
    subscribeVisibility,
    () => readVisibilityRaw(tableId),
    () => '',
  );
  const columnVisibility = useMemo(() => parseVisibility(raw), [raw]);
  const onColumnVisibilityChange = useCallback(
    (updater: ColumnVisibilityState | ((prev: ColumnVisibilityState) => ColumnVisibilityState)) => {
      const prev = parseVisibility(readVisibilityRaw(tableId));
      writeVisibility(tableId, typeof updater === 'function' ? updater(prev) : updater);
    },
    [tableId],
  );

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId: (row) => row.id,
    manualSorting: true,
    enableSortingRemoval: false,
    state: { columnVisibility },
    onColumnVisibilityChange,
  });

  const hideable = table
    .getAllLeafColumns()
    .filter((c) => !c.columnDef.meta?.alwaysVisible)
    .map((c) => ({
      id: c.id,
      label: typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id,
      visible: c.getIsVisible(),
      toggle: () => c.toggleVisibility(),
    }));

  return (
    <div className={cn('hidden flex-col gap-3 lg:flex', className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
        <div className="flex shrink-0 items-center gap-2">
          <DataTableColumnsMenu columns={hideable} />
          {actions}
        </div>
      </div>

      {data.length === 0 && empty ? (
        empty
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-secondary/80 backdrop-blur">
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id} className="hover:bg-transparent">
                    {group.headers.map((header) => {
                      const meta = header.column.columnDef.meta;
                      const label = <table.FlexRender header={header} />;
                      const active = Boolean(meta?.sortKey && sort.column === meta.sortKey);
                      const Icon = active ? (sort.desc ? ArrowDown : ArrowUp) : ChevronsUpDown;
                      return (
                        <TableHead
                          key={header.id}
                          aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : undefined}
                          className={cn(
                            'h-11 text-[12px] font-semibold tracking-[0.04em] text-muted-foreground uppercase',
                            meta?.align === 'right' && 'text-right',
                            meta?.className,
                          )}
                        >
                          {meta?.sortKey ? (
                            <Link
                              href={sortHref(
                                sortBase.pathname,
                                sortBase.query,
                                nextSort(sort, meta.sortKey, meta.sortDescFirst ?? false),
                              )}
                              className={cn(
                                'group -mx-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 transition-colors hover:bg-secondary hover:text-foreground',
                                active && 'text-foreground',
                                meta.align === 'right' && 'flex-row-reverse',
                              )}
                            >
                              {label}
                              <Icon
                                aria-hidden="true"
                                className={cn(
                                  'size-3.5 shrink-0',
                                  active
                                    ? 'text-foreground'
                                    : 'text-[#a8a29a] group-hover:text-foreground',
                                )}
                              />
                            </Link>
                          ) : (
                            label
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} data-testid={rowTestId} className="hover:bg-secondary/60">
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta;
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            'py-3',
                            meta?.align === 'right' && 'text-right',
                            meta?.className,
                          )}
                        >
                          <table.FlexRender cell={cell} />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {pagination ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-secondary/40 px-4 py-2.5 text-[13px] text-muted-foreground">
              <label className="flex items-center gap-2">
                Rows per page
                <select
                  value={pagination.size}
                  onChange={(e) =>
                    router.push(pageHref(sortBase, { size: Number(e.target.value) as PageSize }))
                  }
                  className="h-8 rounded-md border border-input bg-card px-2 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  aria-label="Rows per page"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-3">
                <span className="tabular" data-testid="table-range">
                  {pagination.from}–{pagination.to} of {pagination.total}
                </span>
                <nav aria-label="Pagination" className="flex items-center gap-1">
                  <PagerLink
                    href={pageHref(sortBase, { page: pagination.page - 1 })}
                    disabled={pagination.page <= 1}
                    label="Previous page"
                  >
                    <ChevronLeft className="size-4" aria-hidden="true" />
                  </PagerLink>
                  <span className="px-1 tabular">
                    {pagination.page} / {pagination.pages}
                  </span>
                  <PagerLink
                    href={pageHref(sortBase, { page: pagination.page + 1 })}
                    disabled={pagination.page >= pagination.pages}
                    label="Next page"
                  >
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </PagerLink>
                </nav>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PagerLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  const cls = 'inline-flex size-8 items-center justify-center rounded-md border';
  return disabled ? (
    <span aria-disabled="true" aria-label={label} className={`${cls} border-border text-[#a8a29a]`}>
      {children}
    </span>
  ) : (
    <Link
      href={href}
      aria-label={label}
      className={`${cls} border-border-strong bg-card text-foreground hover:bg-secondary`}
    >
      {children}
    </Link>
  );
}
