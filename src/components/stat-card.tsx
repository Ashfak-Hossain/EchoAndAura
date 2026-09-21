import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  label: string;
  value: ReactNode;
  /** One line under the number: a trend, a zero-state truth, or an action. */
  detail?: ReactNode;
  /** Colour of the detail line: success for "All clear"/positive trends, accent for actions. */
  detailTone?: 'muted' | 'success' | 'accent';
  /** B3: the urgent card (Pending verification) is tinted while it needs attention. */
  urgent?: boolean;
  className?: string;
}

/**
 * S9/B3 StatCard: 12px card, 18px padding, 13px label, Archivo 36px number
 * (tabular), 13px detail. Urgent = warning tint with dark-amber ink.
 */
export function StatCard({ label, value, detail, detailTone = 'muted', urgent, className }: Props) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 rounded-xl border p-4.5',
        urgent
          ? 'border-[#e8c48a] bg-warning-tint text-[#7a4600]'
          : 'border-border bg-card shadow-sm',
        className,
      )}
    >
      <span className={cn('text-[13px] font-medium', urgent ? '' : 'text-muted-foreground')}>
        {label}
      </span>
      <span className="font-heading tabular text-4xl leading-none font-semibold">{value}</span>
      {detail ? (
        <span
          className={cn(
            'text-[13px]',
            urgent
              ? 'font-semibold'
              : detailTone === 'success'
                ? 'font-medium text-success'
                : detailTone === 'accent'
                  ? 'font-semibold text-accent-ink'
                  : 'text-muted-foreground',
          )}
        >
          {detail}
        </span>
      ) : null}
    </div>
  );
}
