import { ImageResponse } from 'next/og';
import { BrandMark, brandFonts } from '@/lib/brand/og';

// ADR-042: the site icon (browser tabs, search results, the manifest, the
// Organization logo in structured data: at least 112 px for Google).
export const dynamic = 'force-static';
export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default async function Icon() {
  return new ImageResponse(<BrandMark size={size.width} />, {
    ...size,
    fonts: await brandFonts(),
  });
}
