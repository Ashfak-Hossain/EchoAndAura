import { z } from 'zod';
import {
  CHECK_IN_DEFAULT_SORT,
  CHECK_IN_SHOW,
  CHECK_IN_SORT_COLUMNS,
  type CheckInShow,
  type CheckInSortColumn,
} from '@/server/lib/check-in';
import { parseSort, type SortState } from '@/lib/table-sort';

/**
 * B11 check-in list: the URL is the state (`?q=&sort=`), so the schema is
 * lenient — an unknown sort falls back to the default, never a 400.
 */
export const checkInQuerySchema = z.object({
  q: z
    .string()
    .optional()
    .transform((v) => (v ?? '').trim().slice(0, 80)),
  sort: z
    .string()
    .optional()
    .transform((v): SortState<CheckInSortColumn> =>
      parseSort(v, CHECK_IN_SORT_COLUMNS, CHECK_IN_DEFAULT_SORT),
    ),
  // ADR-030 — lenient like the rest: anything unknown means "all".
  show: z
    .string()
    .optional()
    .transform((v): CheckInShow =>
      (CHECK_IN_SHOW as readonly string[]).includes(v ?? '') ? (v as CheckInShow) : 'all',
    ),
});

export type CheckInQueryInput = z.infer<typeof checkInQuerySchema>;
