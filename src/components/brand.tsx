import { BRAND_COLORS, LOCKUP, MARK, MARK_SMALL, WORDMARK, type Mark } from '@/lib/brand/marks';

/**
 * The brand on the web (docs/BRAND.md). Ink follows `currentColor`, so the
 * same component works on paper and on charcoal; the dot and the ampersand
 * stay marigold unless `mono`. Decorative by default: the surrounding link or
 * heading names it. Pass `title` where the logo is the only label.
 */
interface Props {
  className?: string;
  /** One colour throughout (prints, single-ink uses). */
  mono?: boolean;
  title?: string;
}

function MarkShapes({ mark, accent }: { mark: Mark; accent: string }) {
  return (
    <>
      <path
        d={mark.curl.d}
        fill="none"
        stroke="currentColor"
        strokeWidth={mark.curl.width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {mark.arc ? (
        <path
          d={mark.arc.d}
          fill="none"
          stroke="currentColor"
          strokeWidth={mark.arc.width}
          strokeLinecap="round"
        />
      ) : null}
      <circle cx={mark.dot.cx} cy={mark.dot.cy} r={mark.dot.r} fill={accent} />
    </>
  );
}

function a11y(title: string | undefined) {
  return title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };
}

/** The mark alone. `small` is the cut for anything under 32 px. */
export function BrandMark({
  small = false,
  mono = false,
  className,
  title,
}: Props & { small?: boolean }) {
  const mark = small ? MARK_SMALL : MARK;
  return (
    <svg viewBox={mark.viewBox} className={className} {...a11y(title)}>
      <MarkShapes mark={mark} accent={mono ? 'currentColor' : BRAND_COLORS.marigold} />
    </svg>
  );
}

/** The horizontal lockup: mark + "echo&aura". Size it by height; width follows. */
export function BrandLogo({ mono = false, className, title }: Props) {
  const accent = mono ? 'currentColor' : BRAND_COLORS.marigold;
  return (
    <svg viewBox={LOCKUP.viewBox} className={className} {...a11y(title)}>
      <g transform={LOCKUP.markTransform}>
        <MarkShapes mark={MARK} accent={accent} />
      </g>
      <g transform={LOCKUP.wordmarkTransform}>
        {WORDMARK.parts.map((part) => (
          <path
            key={part.d.slice(0, 16)}
            d={part.d}
            fill={part.role === 'accent' ? accent : 'currentColor'}
          />
        ))}
      </g>
    </svg>
  );
}
