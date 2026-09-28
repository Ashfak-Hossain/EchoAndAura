import type { ReactNode } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { cn } from '@/lib/utils';
import { DHAKA_TZ } from '@/lib/time';

/**
 * Canvas 5 (A7 evolved) — the help & policies shell: a 984 px column
 * (a 240 px table of contents + 64 + a 680 px measure on desktop), 16 px
 * side margin on phones, 64 px on desktop. `id="top"` is where "Back to
 * top" lands.
 */
export function HelpMain({ children }: { children: ReactNode }) {
  return (
    <main id="top" className="help-page flex-1 scroll-mt-24 px-4 pb-16 lg:px-16 print:p-0">
      <div className="mx-auto max-w-246">{children}</div>
    </main>
  );
}

/** Overline style (12 px, 500, +14% tracking, uppercase) — used for labels across the pages. */
export const overline = 'text-xs font-medium tracking-[0.14em] uppercase';

/**
 * The desktop table of contents beside the text (policies, FAQ). Always
 * sticky, and never taller than the window: on a short one (a 1366×768
 * laptop, or any screen zoomed in) it scrolls on its own instead of
 * running off the bottom, and scrolling it never moves the page. TocSpy
 * keeps the highlighted entry inside it. The 6 px padding (cancelled by
 * the negative margin, so nothing moves) is room for the focus ring, which
 * reaches 5 px outside a link and a scrolling box would otherwise clip.
 */
export const tocAside =
  'top-24 -mx-1.5 hidden max-h-[calc(100dvh-7rem)] flex-col gap-3 overflow-y-auto overscroll-contain px-1.5 pb-1.5 lg:sticky lg:flex';

/**
 * K1 — overline, h1, one-line purpose (the page's metadata description)
 * and, on policies, "Last updated … (Dhaka)".
 */
export function HelpHeader({
  eyebrow,
  title,
  lead,
  lastUpdated,
  className,
}: {
  eyebrow: string;
  title: string;
  lead: ReactNode;
  lastUpdated?: Date;
  className?: string;
}) {
  return (
    <header
      className={cn('flex flex-col gap-3 border-b border-border pt-6 pb-8 lg:pt-12', className)}
    >
      <p className={cn(overline, 'text-muted-foreground')}>{eyebrow}</p>
      <h1 className="font-heading text-3xl leading-[1.1] font-bold tracking-[-0.02em] lg:text-4xl">
        {title}
      </h1>
      <p className="max-w-170 text-base leading-[1.55] text-pretty lg:text-lg">{lead}</p>
      {lastUpdated ? (
        <p className="text-sm text-muted-foreground tabular">
          Last updated{' '}
          <time dateTime={formatInTimeZone(lastUpdated, DHAKA_TZ, 'yyyy-MM-dd')}>
            {formatInTimeZone(lastUpdated, DHAKA_TZ, 'EEE d MMM yyyy')}
          </time>{' '}
          (Dhaka)
        </p>
      ) : null}
    </header>
  );
}

/** K11 — an order reference or ticket code, set in mono. */
export function CodeRef({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-sm border border-border bg-secondary px-2 py-1 font-mono text-sm font-medium tracking-[0.02em]">
      {children}
    </code>
  );
}

/** K6 — one of the rules people must not miss, placed inside the section that states it. */
export function Callout({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      role="note"
      className="flex break-inside-avoid flex-col gap-2 rounded-xl border border-accent-border bg-accent p-5 print:border-black print:bg-white"
    >
      <p className={cn(overline, 'text-accent-ink')}>{label}</p>
      <p className="font-heading text-lg leading-[1.35] font-semibold">{title}</p>
      <div className="text-base leading-[1.6]">{children}</div>
    </div>
  );
}
