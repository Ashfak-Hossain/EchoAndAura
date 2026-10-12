import { BRAND_COLORS, LOCKUP, MARK, WORDMARK } from '@/lib/brand.generated';

/**
 * The app's lockup (docs/BRAND.md), drawn from a generated copy of its brand
 * data. Ink follows `currentColor`, so it reads on the light and dark themes;
 * the dot and the ampersand stay marigold. Decorative: the nav link names it.
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <svg viewBox={LOCKUP.viewBox} className={className} aria-hidden="true">
      <g transform={LOCKUP.markTransform}>
        {[MARK.curl, MARK.arc].map((part) => (
          <path
            key={part.d}
            d={part.d}
            fill="none"
            stroke="currentColor"
            strokeWidth={part.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        <circle cx={MARK.dot.cx} cy={MARK.dot.cy} r={MARK.dot.r} fill={BRAND_COLORS.marigold} />
      </g>
      <g transform={LOCKUP.wordmarkTransform}>
        {WORDMARK.parts.map((part) => (
          <path
            key={part.d.slice(0, 16)}
            d={part.d}
            fill={part.role === 'accent' ? BRAND_COLORS.marigold : 'currentColor'}
          />
        ))}
      </g>
    </svg>
  );
}
