import type { ReactNode } from 'react';

/** A1 section label: mono, tracked, uppercase — the canvas 2 eyebrow style. */
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
    <div className="flex items-baseline justify-between gap-4">
      <h2
        id={id}
        className="font-sans text-xs font-medium tracking-widest text-muted-foreground uppercase"
      >
        {children}
      </h2>
      {aside}
    </div>
  );
}
