import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface TabItem {
  key: string;
  label: string;
  href: string;
  count?: number;
}

interface Props {
  items: TabItem[];
  active: string;
  /** Accessible name for the tab list. */
  label: string;
  /**
   * `underline` — B5 editor tabs: 14px, 14/16 padding, 2px charcoal underline.
   * `segmented` — B4 filter: 36px bordered group, active segment solid charcoal.
   */
  variant?: 'underline' | 'segmented';
  className?: string;
}

/** Server-rendered link tabs: deep-linkable, no client state. */
export function TabNav({ items, active, label, variant = 'underline', className }: Props) {
  if (variant === 'segmented') {
    return (
      <nav
        aria-label={label}
        className={cn(
          'inline-flex overflow-hidden rounded-lg border border-border-strong bg-card',
          className,
        )}
      >
        {items.map((item, i) => {
          const isActive = item.key === active;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex h-9 items-center gap-1.5 px-3.5 text-[13px] whitespace-nowrap',
                i > 0 && 'border-l border-border',
                isActive ? 'bg-foreground font-semibold text-background' : 'hover:bg-secondary',
              )}
            >
              {item.label}
              {item.count !== undefined ? (
                <span
                  className={cn(
                    'tabular',
                    isActive ? 'text-background/80' : 'text-muted-foreground',
                  )}
                >
                  {item.count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label={label} className={cn('flex gap-1 border-b border-border', className)}>
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              '-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-3.5 text-sm whitespace-nowrap transition-colors',
              isActive
                ? 'border-foreground font-semibold text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className="text-[#a8a29a] tabular">{item.count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
