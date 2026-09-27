import { z } from 'zod';
import { REPORT_RANGES, type ReportRange } from '@/lib/report-range';

/**
 * B12 reports: the URL is the state (`?event=&range=`), so the schema is
 * lenient — an unknown event id or range falls back, never a 400. The
 * page then picks its default event.
 */
export const REPORT_CSV_SECTIONS = ['summary', 'daily', 'overview'] as const;
export type ReportCsvSection = (typeof REPORT_CSV_SECTIONS)[number];

const lenient = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z
    .string()
    .optional()
    .transform((v): T[number] => (v && (values as readonly string[]).includes(v) ? v : fallback));

/** No range in the URL means "let the service choose" (14 days, or all time for a finished event). */
const optionalRange = z
  .string()
  .optional()
  .transform((v): ReportRange | undefined =>
    v && (REPORT_RANGES as readonly string[]).includes(v) ? (v as ReportRange) : undefined,
  );

export const reportsQuerySchema = z.object({
  event: z
    .string()
    .optional()
    .transform((v) => (v && z.uuid().safeParse(v).success ? v : undefined)),
  range: optionalRange,
  section: lenient(REPORT_CSV_SECTIONS, 'summary'),
});

export type ReportsQueryInput = z.infer<typeof reportsQuerySchema>;
