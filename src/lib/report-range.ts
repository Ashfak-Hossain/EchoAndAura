/**
 * B12 report periods. A tiny module of its own so the client toolbar can
 * import the list without pulling server code into the bundle.
 */
export const REPORT_RANGES = ['14', '30', '90', 'all'] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

export const REPORT_RANGE_LABELS: Record<ReportRange, string> = {
  '14': '14 days',
  '30': '30 days',
  '90': '90 days',
  all: 'All time',
};
