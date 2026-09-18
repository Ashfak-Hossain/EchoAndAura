import { formatBDT } from '@/server/lib/money';
import { cn } from '@/lib/utils';

/** Integer paisa → "৳1,234.56", tabular figures (S2). The only money renderer. */
export function Money({ paisa, className }: { paisa: number; className?: string }) {
  return <span className={cn('tabular', className)}>{formatBDT(paisa)}</span>;
}
