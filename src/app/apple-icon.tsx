import { ImageResponse } from 'next/og';
import { BrandMark, brandFonts } from '@/lib/brand/og';

// ADR-042: the home-screen icon on iPhones.
export const dynamic = 'force-static';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default async function AppleIcon() {
  return new ImageResponse(<BrandMark size={size.width} />, {
    ...size,
    fonts: await brandFonts(),
  });
}
