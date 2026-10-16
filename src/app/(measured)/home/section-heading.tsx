import type { ReactNode } from 'react';

/**
 * N9 section rhythm for the home page's light sections: 96px above each
 * (64 on phones), a 1312px column with 64/16px gutters. The page closes
 * with one spacer of the same height, so sections carry top padding only.
 */
export const homeSection = 'px-4 pt-16 lg:px-16 lg:pt-24';
export const homeColumn = 'mx-auto w-full max-w-328';

/** N9 h2: Archivo 36/24, bold. The base layer's semibold and -0.01em are overridden. */
export const sectionTitle =
  'text-[24px] leading-[1.15] font-bold tracking-[-0.02em] lg:text-[36px]';

/** A section's text link ("All upcoming events (5) →"): accent ink, underlined, 44px tall. */
export const sectionLink =
  'inline-flex min-h-11 items-center text-base font-semibold text-accent-ink underline underline-offset-2 hover:text-foreground';

/** Section title with an optional link at the end of the row (wraps under it on phones). */
export function SectionHeading({
  id,
  children,
  aside,
}: {
  id: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
      <h2 id={id} className={sectionTitle}>
        {children}
      </h2>
      {aside}
    </div>
  );
}
