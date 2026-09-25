import { BrandMark } from '@/components/public/brand-mark';
import { cn } from '@/lib/utils';

/** The charcoal band's cover frame (N7): 1200×630, radius 12, a hairline on the band. */
export const bandCover = 'aspect-[1200/630] w-full rounded-lg border border-[#33302a] bg-[#2a2722]';

/**
 * The band cover's rendered width, for next/image's `sizes` (ADR-033): the
 * 6fr column of a 5fr/6fr grid inside max-w-360 (1440) with 64px gutters
 * and a 64px gap — (1440 − 128 − 64) × 6/11 ≈ 681px at the cap, ~47vw
 * below it; full width minus the 16px gutters on phones.
 */
export const BAND_COVER_SIZES = '(min-width: 1440px) 681px, (min-width: 1024px) 47vw, 100vw';

/**
 * What stands in for a cover on the charcoal band: the hero's event has
 * none yet, or the dormant page has no past show to point at. The brand
 * mark keeps the frame from reading as a broken image. Decorative only.
 */
export function CoverPlaceholder({ className }: { className?: string }) {
  return (
    <div
      data-testid="cover-placeholder"
      className={cn(bandCover, 'flex items-center justify-center', className)}
    >
      <BrandMark inverted className="size-16 [&_svg]:size-9" />
    </div>
  );
}
