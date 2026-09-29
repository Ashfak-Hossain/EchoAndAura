import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

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

/** The square mark: "ea" in the brand colours, for icons at any size. */
export function BrandMark({ size }: { size: number }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: BRAND_DARK,
        color: BRAND_LIGHT,
        fontFamily: 'Noto Sans',
        fontWeight: 700,
        fontSize: Math.round(size * 0.46),
        letterSpacing: Math.round(-size * 0.02),
      }}
    >
      ea
    </div>
  );
}
