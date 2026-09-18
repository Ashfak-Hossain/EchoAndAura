import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  /** A single glyph or icon in the marigold disc. */
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** S6 EmptyState: says what is true and what to do next, never just "No data". */
export function EmptyState({ icon = '+', title, description, action, className }: Props) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center',
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-accent font-heading text-xl text-accent-ink">
        {icon}
      </div>
      <h3 className="text-xl">{title}</h3>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
