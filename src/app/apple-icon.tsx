import { ImageResponse } from 'next/og';
import { AppIcon } from '@/lib/brand/og';

// ADR-042: the home-screen icon on iPhones.
export const dynamic = 'force-static';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(<AppIcon />, size);
}
