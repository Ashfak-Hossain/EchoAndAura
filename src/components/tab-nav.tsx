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
  className?: string;
}

/**
 * S9 Tabs as links: server-rendered, deep-linkable, no client state. Counts
 * are baked in so the shape of the data shows before filtering (B4).
 */
export function TabNav({ items, active, label, className }: Props) {
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
              '-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs tabular',
                  isActive ? 'bg-accent text-accent-ink' : 'bg-secondary text-muted-foreground',
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
