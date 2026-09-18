'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ADMIN_NAV, isNavItemActive } from './nav-items';

interface Props {
  /** Larger rows on touch (B2 mobile sheet: 48px). */
  size?: 'default' | 'touch';
  onNavigate?: () => void;
}

export function AdminNav({ size = 'default', onNavigate }: Props) {
  const pathname = usePathname();
  const row = cn(
    'flex items-center justify-between rounded-md px-3 text-sm font-medium',
    size === 'touch' ? 'h-12' : 'h-9',
  );

  return (
    <nav aria-label="Admin" className="flex flex-col gap-0.5">
      {ADMIN_NAV.map((item) => {
        if (item.disabled) {
          return (
            <span
              key={item.href}
              aria-disabled="true"
              title="Coming in a later phase"
              className={cn(row, 'cursor-not-allowed text-muted-foreground/60')}
            >
              {item.label}
              <span className="text-[10px] tracking-[0.12em] uppercase">soon</span>
            </span>
          );
        }
        const active = isNavItemActive(item, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
            className={cn(
              row,
              active
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground hover:bg-secondary',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
