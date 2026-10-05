import type { Locale } from '@/i18n/locales';
import { formatBDT } from '@/server/lib/money';
import { cn } from '@/lib/utils';

/** Integer paisa → "৳1,234.56", tabular figures (S2). The only money renderer. */
export function Money({
  paisa,
  className,
  locale = 'en',
}: {
  paisa: number;
  className?: string;
  /** ADR-061: Bangla digits and lakh grouping on /bn pages. */
  locale?: Locale;
}) {
  return <span className={cn('tabular', className)}>{formatBDT(paisa, locale)}</span>;
}
