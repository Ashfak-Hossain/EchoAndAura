import { BrandMark } from '@/components/public/brand-mark';
import { cn } from '@/lib/utils';

/** The charcoal band's cover frame (N7): 1200×630, radius 12, a hairline on the band. */
export const bandCover = 'aspect-[1200/630] w-full rounded-lg border border-[#33302a] bg-[#2a2722]';

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
