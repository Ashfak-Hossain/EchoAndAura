import { cn } from '@/lib/utils';

interface Props {
  total: number;
  sold: number;
  /** Held (reserved) stock — drawn as a marigold segment so it reads apart from sold (B3). */
  held?: number;
  className?: string;
  label?: string;
}

/** Plain-div progress bar: charcoal = sold, marigold = held, ground = available. */
export function ProgressBar({ total, sold, held = 0, className, label }: Props) {
  const pct = (n: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={sold + held}
      className={cn('flex h-2 w-full overflow-hidden rounded-full bg-secondary', className)}
    >
      <div className="h-full bg-foreground" style={{ width: `${pct(sold)}%` }} />
      <div className="h-full bg-primary" style={{ width: `${pct(held)}%` }} />
    </div>
  );
}
