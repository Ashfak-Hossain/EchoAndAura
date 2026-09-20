'use client';

import Link from 'next/link';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { nextSort, type SortState, sortHref } from '@/lib/table-sort';
import { DataTableColumnsMenu } from './data-table-columns-menu';

/**
 * The admin's one data table (ADR-022), TanStack Table in server-controlled
 * mode: the page fetches, filters, sorts and paginates on the server (the
 * URL is the state); this component renders the rows it is given and owns
 * only column visibility. Sorting is a link per header, so it works without
 * JavaScript and the back button undoes it. Desktop only — pages keep
 * their phone card lists under `lg`.
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
  /** Where header clicks link: the page's path and its current query string. */
  sortBase: { pathname: string; query: string };
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
  rowTestId,
  empty,
  className,
}: DataTableProps<TData>) {
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
    <div className={cn('hidden flex-col gap-2 lg:flex', className)}>
      <div className="flex justify-end">
        <DataTableColumnsMenu columns={hideable} />
      </div>
      {data.length === 0 && empty ? (
        empty
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((header) => {
                    const meta = header.column.columnDef.meta;
                    const label = <table.FlexRender header={header} />;
                    const active = meta?.sortKey && sort.column === meta.sortKey;
                    return (
                      <TableHead
                        key={header.id}
                        aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : undefined}
                        className={cn(meta?.align === 'right' && 'text-right', meta?.className)}
                      >
                        {meta?.sortKey ? (
                          <Link
                            href={sortHref(
                              sortBase.pathname,
                              sortBase.query,
                              nextSort(sort, meta.sortKey, meta.sortDescFirst ?? false),
                            )}
                            className={cn(
                              'inline-flex items-center gap-1 hover:text-foreground',
                              active && 'text-foreground',
                            )}
                          >
                            {label}
                            <span aria-hidden="true" className="text-[10px]">
                              {active ? (sort.desc ? '▼' : '▲') : '△'}
                            </span>
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
                <TableRow key={row.id} data-testid={rowTestId}>
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(meta?.align === 'right' && 'text-right', meta?.className)}
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
      )}
    </div>
  );
}
