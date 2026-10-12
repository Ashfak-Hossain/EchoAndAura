import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { BRAND_COLORS, LOCKUP, MARK, WORDMARK } from '@/lib/brand.generated';

/**
 * The share image (1200x630), rendered once at build: the lockup in paper
 * and marigold on charcoal, then the page's label, title and description.
 * Noto Sans from the app's ticket-PDF fonts (OFL), read from the repository
 * at build time, so the build fetches nothing.
 */
export const OG_SIZE = { width: 1200, height: 630 };

const FONT_DIR = join(process.cwd(), '../src/server/pdf/fonts');
const FONTS = [
  { file: 'NotoSans-Regular.ttf', weight: 400 as const },
  { file: 'NotoSans-Bold.ttf', weight: 700 as const },
].map(({ file, weight }) => ({
  name: 'Noto Sans',
  data: readFileSync(join(FONT_DIR, file)),
  weight,
  style: 'normal' as const,
}));

function Logo({ height }: { height: number }) {
  const [, , w, h] = LOCKUP.viewBox.split(' ').map(Number) as [number, number, number, number];
  const ink = BRAND_COLORS.paper;
  return (
    <svg width={Math.round((height * w) / h)} height={height} viewBox={LOCKUP.viewBox}>
      <g transform={LOCKUP.markTransform}>
        {[MARK.curl, MARK.arc].map((part) => (
          <path
            key={part.d}
            d={part.d}
            fill="none"
            stroke={ink}
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
            fill={part.role === 'accent' ? BRAND_COLORS.marigold : ink}
          />
        ))}
      </g>
    </svg>
  );
}

export function ogImage({
  label,
  title,
  description,
}: {
  label: string;
  title: string;
  description?: string;
}): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 72px',
        background: BRAND_COLORS.ink,
        color: BRAND_COLORS.paper,
        fontFamily: 'Noto Sans',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <Logo height={64} />
        <span style={{ fontSize: 26, color: '#a8a296' }}>developer docs</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <span
          style={{
            fontSize: 24,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: BRAND_COLORS.marigold,
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1.5 }}>
          {title}
        </span>
        {description ? (
          <span style={{ fontSize: 28, lineHeight: 1.4, color: '#c9c3b8', maxWidth: 960 }}>
            {description}
          </span>
        ) : null}
      </div>
    </div>,
    { ...OG_SIZE, fonts: FONTS },
  );
}
