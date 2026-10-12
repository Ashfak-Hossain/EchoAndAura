import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BRAND_COLORS, LOCKUP, MARK, WORDMARK } from './marks';

/**
 * ADR-042: the site's generated images: the default share card and the
 * icons. Rendered once at build time (the files are static), with the Noto
 * Sans the ticket PDF already ships, so no font is fetched from the network.
 */
export const BRAND_DARK = '#1c1a17';
export const BRAND_LIGHT = '#fbfaf8';

const FONT_DIR = join(process.cwd(), 'src/server/pdf/fonts');

export async function brandFonts() {
  const [regular, bold] = await Promise.all([
    readFile(join(FONT_DIR, 'NotoSans-Regular.ttf')),
    readFile(join(FONT_DIR, 'NotoSans-Bold.ttf')),
  ]);
  return [
    { name: 'Noto Sans', data: regular, weight: 400 as const, style: 'normal' as const },
    { name: 'Noto Sans', data: bold, weight: 700 as const, style: 'normal' as const },
  ];
}

/**
 * The app icon (docs/BRAND.md): the full mark, all marigold, on a full-bleed
 * charcoal square; platforms round the corners themselves. The mark fills 66%
 * of the square, inside the maskable safe zone (a 40%-radius circle).
 */
export function AppIcon() {
  const stroke = (part: { d: string; width: number }) => (
    <path
      d={part.d}
      fill="none"
      stroke={BRAND_COLORS.marigold}
      strokeWidth={part.width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: BRAND_DARK }}>
      <svg width="100%" height="100%" viewBox="0 0 100 100">
        <g transform="translate(17.67 18.23) scale(0.66)">
          {stroke(MARK.curl)}
          {MARK.arc ? stroke(MARK.arc) : null}
          <circle cx={MARK.dot.cx} cy={MARK.dot.cy} r={MARK.dot.r} fill={BRAND_COLORS.marigold} />
        </g>
      </svg>
    </div>
  );
}

/** The lockup in paper and marigold, for the charcoal share card. */
export function LogoOnDark({ height }: { height: number }) {
  const [, , w, h] = LOCKUP.viewBox.split(' ').map(Number) as [number, number, number, number];
  const ink = BRAND_LIGHT;
  return (
    <svg width={Math.round((height * w) / h)} height={height} viewBox={LOCKUP.viewBox}>
      <g transform={LOCKUP.markTransform}>
        <path
          d={MARK.curl.d}
          fill="none"
          stroke={ink}
          strokeWidth={MARK.curl.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {MARK.arc ? (
          <path
            d={MARK.arc.d}
            fill="none"
            stroke={ink}
            strokeWidth={MARK.arc.width}
            strokeLinecap="round"
          />
        ) : null}
        <circle cx={MARK.dot.cx} cy={MARK.dot.cy} r={MARK.dot.r} fill={BRAND_COLORS.marigold} />
      </g>
      <g transform={LOCKUP.wordmarkTransform}>
        {WORDMARK.parts.map((part) => (
          <path
            key={part.d.slice(0, 16)}
            d={part.d}
            fill={part.role === 'accent' ? BRAND_COLORS.marigold : ink}
          />
        ))}
      </g>
    </svg>
  );
}
