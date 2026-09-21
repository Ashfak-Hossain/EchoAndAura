import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** One section of the report: the B3 card idiom with a title row. */
export function ReportCard({
  title,
  subtitle,
  aside,
  children,
  className,
  testId,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Right-aligned meta or a link. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm print:break-inside-avoid print:shadow-none',
        className,
      )}
      aria-label={title}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg leading-tight">{title}</h2>
          {subtitle ? <p className="text-[13px] text-muted-foreground">{subtitle}</p> : null}
        </div>
        {aside ? <div className="text-[13px] text-muted-foreground">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Thousands-grouped count for the report's figures ("1,240"). */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** "+62" / "−5" / "0", for deltas. */
export function formatSigned(n: number): string {
  if (n > 0) return `+${formatCount(n)}`;
  if (n < 0) return `−${formatCount(-n)}`;
  return '0';
}
