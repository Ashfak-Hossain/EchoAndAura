import { cn } from '@/lib/utils';

/** The wordmark's tile: four sound bars in marigold on charcoal (inverted on dark). */
export function BrandMark({
  inverted = false,
  className,
}: {
  inverted?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-lg',
        inverted ? 'bg-marigold' : 'bg-foreground',
        className,
      )}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke={inverted ? '#1c1a17' : '#eda43c'}
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M3 6v4M6.5 3.5v9M10 5.5v5M13 7v2" />
      </svg>
    </span>
  );
}
