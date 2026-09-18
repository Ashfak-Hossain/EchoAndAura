'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ADMIN_NAV, isNavItemActive } from './nav-items';

interface Props {
  /** B2: 44px rows in the sidebar, 48px in the mobile sheet. */
  size?: 'default' | 'touch';
  onNavigate?: () => void;
}

export function AdminNav({ size = 'default', onNavigate }: Props) {
  const pathname = usePathname();
  const row = cn(
    'flex items-center justify-between rounded-lg px-3',
    size === 'touch' ? 'h-12 text-base' : 'h-11 text-[15px]',
  );

  return (
    <nav aria-label="Admin" className="flex flex-col gap-1">
      {ADMIN_NAV.map((item) => {
        if (item.disabled) {
          return (
            <span
              key={item.href}
              aria-disabled="true"
              title="Coming in a later phase"
              className={cn(row, 'cursor-not-allowed text-sidebar-foreground/50')}
            >
              {item.label}
              <span className="font-mono text-[10px] tracking-[0.12em] uppercase">soon</span>
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
                ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Header title = the active section (B2 header shows "Dashboard", "Events", …). */
export function ActiveSectionTitle() {
  const pathname = usePathname();
  const item = ADMIN_NAV.find((i) => isNavItemActive(i, pathname));
  return <>{item?.label ?? 'echoandaura'}</>;
}
