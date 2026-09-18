import { cn } from '@/lib/utils';

interface Props {
  total: number;
  sold: number;
  /** Held (reserved) stock — a marigold segment so it reads apart from sold (B3). */
  held?: number;
  /** Fully sold types render green (B3 "window closed" Early Bird). */
  complete?: boolean;
  className?: string;
  label?: string;
}

/** B3 plain-div bar: 10px, #EDEAE3 track, charcoal = sold, marigold = held. */
export function ProgressBar({ total, sold, held = 0, complete, className, label }: Props) {
  const pct = (n: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={sold + held}
      className={cn('flex h-2.5 w-full overflow-hidden rounded-[5px] bg-[#edeae3]', className)}
    >
      <div
        className={cn('h-full', complete ? 'bg-success' : 'bg-foreground')}
        style={{ width: `${pct(sold)}%` }}
      />
      <div className="h-full bg-marigold" style={{ width: `${pct(held)}%` }} />
    </div>
  );
}
