import type { ReactNode } from 'react';

/** Home section title (redesign 2026-09-21): Archivo display-30 with an optional aside link. */
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
        className="font-heading text-[24px] leading-tight font-semibold tracking-[-0.01em] lg:text-[30px]"
      >
        {children}
      </h2>
      {aside}
    </div>
  );
}
